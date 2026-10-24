// Фейк диспетчера каналов платформы — GET …/channel/mux по договору стыка (граф
// @nks/nks-dev, #8620): subscribe{secret, ref} → hello{ref, channel_id, sub, …}; кадры
// сервера с меткой канала, sub и seq; ack{channel_id, sub, seq}; пачка такта tick{entries};
// unsubscribe → channel_closed{…, 1000, unsubscribed}; отказ подписки — error{ref, code}.
// Садится на сервер fake-nks.mjs: секрет — адрес сокета из connect, канал и места — его.
// mode "old" — сервер без диспетчера: апгрейд по адресу диспетчера отвечает 404;
// mode "down" — диспетчер есть, но лежит: 503; mode "cut" — обрыв до всякого ответа.
// Тот же адрес простым GET без апгрейда: 404 без диспетчера, 426 с ним, 503 лежащий.
import { createHash, randomUUID } from "node:crypto";

import { clientFrames, wsFrame } from "./fake-nks.mjs";

const ACCEPT = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const REFUSED = { old: 404, down: 503 };
const PLAIN = { old: 404, down: 503, mux: 426 };

export function attachMux(fake, opts = {}) {
  const st = fake.state;
  const mux = {
    mode: opts.mode ?? "mux",
    credit: opts.credit ?? 32,
    pingS: opts.pingS ?? 30,
    attempts: [], // { at, path, answered } — каждый апгрейд по адресу диспетчера
    plain: [], // { at, answered } — простые GET по адресу диспетчера (answered null — обрыв)
    conns: [], // { id, socket, subs: Map(channel_id → подписка), frames: [], closed }
    refuse: new Map(), // секрет → код отказа подписки (secret_invalid, secret_dead…)
    refuseWhen: null, // (секрет) → код отказа или null — для секретов, ещё не выданных
    holdAcks: false, // квитанции пишутся, но не метят доставленным (потеря ack)
    stalled: new Map(), // channel_id → [{ conn, frame }] — квитанции, придержанные до unstall
    ignoredAcks: [], // ack с чужим sub — сервер их игнорирует
    queues: new Map(), // channel_id → [{ id, frame }] — недоставленное (до ack)
    peak: new Map(), // channel_id → наибольшее число кадров без ack в подписке
    oldClosed: [], // каналы, чей старый сокет закрыт 4000 подпиской
    superseded: [], // { channel_id, from } — подписка вытеснена другим соединением
    ticks: [], // { at, conn, entries }
    usage: new Map(), // standing_id → расход места из последнего tick
  };
  // destroy() кончает сокет сразу, событие close — следующим тиком: обрыв виден без него.
  const live = () => mux.conns.filter((c) => !c.closed && !c.socket.destroyed);
  const send = (conn, obj) => !conn.closed && conn.socket.write(wsFrame(0x1, JSON.stringify(obj)));
  const holderOf = (chan) => live().find((c) => c.subs.has(chan));
  const standingsOf = (chan) =>
    [...(st.channels.get(chan)?.places ?? [])].map(([realm, p]) => ({
      karta_seq: Number(p.karta),
      pending: 0,
      realm,
      standing: `@tester:${p.name}`,
      standing_id: p.standing_id,
    }));
  const listen = (chan, on) => {
    for (const p of st.channels.get(chan)?.places.values() ?? []) {
      const board = st.places.get(`${p.karta}:${p.name}`);
      if (board) board.listening = on;
    }
  };

  /** Неподтверждённое канала — в его подписку, не сверх кредита. */
  const pump = (chan) => {
    const conn = holderOf(chan);
    if (!conn) return;
    const sub = conn.subs.get(chan);
    for (const item of mux.queues.get(chan) ?? []) {
      if (sub.sent.has(item.id)) continue;
      if (sub.sent.size >= mux.credit) return;
      const seq = ++sub.seq;
      sub.sent.set(item.id, seq);
      mux.peak.set(chan, Math.max(mux.peak.get(chan) ?? 0, sub.sent.size));
      send(conn, { ...item.frame, channel_id: chan, sub: sub.sub, seq });
    }
  };

  const subscribe = (conn, { secret, ref }) => {
    const chan = st.wsChannel.get(secret);
    const code =
      mux.refuse.get(secret) ?? mux.refuseWhen?.(secret) ?? (chan ? null : "secret_invalid");
    if (code) return send(conn, { type: "error", ref, code, reason: code });
    if (conn.subs.size >= (opts.limit ?? 256))
      return send(conn, { type: "error", ref, code: "limit_subscriptions" });
    const other = holderOf(chan);
    if (other && other !== conn) {
      other.subs.delete(chan);
      mux.superseded.push({ channel_id: chan, from: other.id });
      send(other, { type: "channel_closed", channel_id: chan, code: 4000, reason: "superseded" });
    }
    for (const old of [...st.ws].filter((s) => st.wsChans.get(s) === chan)) {
      mux.oldClosed.push(chan);
      old.write(wsFrame(0x8, Buffer.from([4000 >> 8, 4000 & 0xff])));
      setTimeout(() => old.end(), 200).unref();
    }
    const sub = { sub: randomUUID(), channel_id: chan, ref, seq: 0, sent: new Map() };
    conn.subs.set(chan, sub);
    listen(chan, true);
    send(conn, {
      type: "hello",
      ref,
      channel_id: chan,
      sub: sub.sub,
      standings: standingsOf(chan),
      pending: (mux.queues.get(chan) ?? []).length,
      ttl_seconds: 86_400,
      ping_interval_seconds: mux.pingS,
      credit: mux.credit,
    });
    pump(chan);
  };

  const ack = (conn, frame) => {
    const { channel_id, sub, seq } = frame;
    const mine = conn.subs.get(channel_id);
    if (!mine || mine.sub !== sub) return mux.ignoredAcks.push({ channel_id, sub, seq });
    if (mux.holdAcks) return;
    if (mux.stalled.has(channel_id)) return mux.stalled.get(channel_id).push({ conn, frame });
    const done = new Set([...mine.sent].filter(([, s]) => s <= seq).map(([id]) => id));
    for (const id of done) mine.sent.delete(id);
    mux.queues.set(
      channel_id,
      (mux.queues.get(channel_id) ?? []).filter((x) => !done.has(x.id)),
    );
    pump(channel_id);
  };

  const tick = (conn, { entries }) => {
    mux.ticks.push({ at: Date.now(), conn: conn.id, entries });
    for (const e of Array.isArray(entries) ? entries : []) {
      if (typeof e.status === "string") {
        st.placeStatus.set(e.standing_id, e.status);
        st.status = e.status;
      }
      if (e.pulse) st.pulses.push({ at: Date.now(), place: e.standing_id, frame: e.pulse });
      if (e.usage) mux.usage.set(e.standing_id, e.usage);
    }
  };

  const onFrame = (conn, frame) => {
    conn.frames.push({ at: Date.now(), frame });
    if (frame?.type === "subscribe") return subscribe(conn, frame);
    if (frame?.type === "ack") return ack(conn, frame);
    if (frame?.type === "tick") return tick(conn, frame);
    if (frame?.type === "unsubscribe" && conn.subs.delete(frame.channel_id)) {
      listen(frame.channel_id, false);
      send(conn, {
        type: "channel_closed",
        channel_id: frame.channel_id,
        code: 1000,
        reason: "unsubscribed",
      });
    }
  };

  const open = (req, socket) => {
    const key = createHash("sha1")
      .update(req.headers["sec-websocket-key"] + ACCEPT)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${key}\r\n\r\n`,
    );
    const conn = { id: mux.conns.length + 1, socket, subs: new Map(), frames: [], closed: false };
    mux.conns.push(conn);
    let inbound = Buffer.alloc(0);
    socket.on("data", (buf) => {
      inbound = Buffer.concat([inbound, buf]);
      for (const f of clientFrames(inbound)) {
        inbound = f.rest;
        if (f.opcode === 0x8) return socket.end();
        if (f.opcode !== 0x1) continue;
        let frame = null;
        try {
          frame = JSON.parse(f.payload.toString("utf8"));
        } catch {}
        onFrame(conn, frame);
      }
    });
    const gone = () => {
      if (conn.closed) return;
      conn.closed = true;
      for (const chan of conn.subs.keys()) if (!holderOf(chan)) listen(chan, false);
    };
    socket.on("end", () => socket.destroy());
    socket.on("close", gone);
    socket.on("error", gone);
  };

  st.upgradeHook = (req, socket, u) => {
    if (!u.pathname.endsWith("/channel/mux")) return false;
    if (mux.mode === "cut") {
      mux.attempts.push({ at: Date.now(), path: u.pathname, answered: null });
      socket.destroy();
      return true;
    }
    const answered = REFUSED[mux.mode] ?? 101;
    mux.attempts.push({ at: Date.now(), path: u.pathname, answered });
    if (answered !== 101) socket.end(`HTTP/1.1 ${answered} Refused\r\nContent-Length: 0\r\n\r\n`);
    else open(req, socket);
    return true;
  };

  st.requestHook = (req, res, u) => {
    if (!u.pathname.endsWith("/channel/mux")) return false;
    const answered = PLAIN[mux.mode] ?? null;
    mux.plain.push({ at: Date.now(), answered });
    if (answered === null) req.socket.destroy();
    else res.writeHead(answered, { "content-length": "0" }).end();
    return true;
  };

  return Object.assign(mux, {
    live,
    /** Кадр месту по имени — в очередь его канала; уходит подпиской, держащей канал. */
    say(name, text, id = `mux-${randomUUID()}`) {
      for (const [chan, c] of st.channels) {
        const found = [...c.places].find(([, p]) => p.name === name);
        if (!found) continue;
        const [realm, pl] = found;
        const frame = {
          type: "message",
          id,
          received_at: new Date().toISOString(),
          stale: false,
          content_type: "text/plain",
          body_chars: text.length,
          to_standing_id: pl.standing_id,
          to_standing: `@tester:${pl.name}`,
          realm,
          karta_seq: Number(pl.karta),
          body: text,
        };
        mux.queues.set(chan, [...(mux.queues.get(chan) ?? []), { id, frame }]);
        pump(chan);
        return chan;
      }
      return null;
    },
    /** Обрыв: соединения диспетчера рвутся без кадра закрытия. */
    drop() {
      for (const c of live()) c.socket.destroy();
    },
    /** Закрытие соединений диспетчера сервером: кадр закрытия с кодом (4001 idle). */
    close(code, reason) {
      const payload = Buffer.concat([Buffer.from([code >> 8, code & 0xff]), Buffer.from(reason)]);
      for (const c of live()) {
        c.socket.write(wsFrame(0x8, payload));
        c.socket.end();
      }
    },
    /**
     * Конец подписки сервером без отписки моста: 4004 revoked:* — отзыв места, секрет канала
     * мёртв, повторная подписка — secret_dead (#8620 v13); иной код — как есть.
     */
    endSub(chan, code, reason) {
      const conn = holderOf(chan);
      if (!conn) return;
      conn.subs.delete(chan);
      if (code === 4004)
        for (const [secret, c] of st.wsChannel)
          if (c === chan) mux.refuse.set(secret, "secret_dead");
      send(conn, { type: "channel_closed", channel_id: chan, code, reason });
    },
    /** Кадр сервера как есть — во все живые соединения. */
    push(obj) {
      for (const c of live()) send(c, obj);
    },
    /** Придержанные квитанции канала — в дело: кредит пополняется. */
    unstall(chan) {
      const held = mux.stalled.get(chan) ?? [];
      mux.stalled.delete(chan);
      for (const { conn, frame } of held) ack(conn, frame);
    },
    /** Кадры клиента данного типа по всем соединениям. */
    sent(type) {
      return mux.conns.flatMap((c) =>
        c.frames.filter((f) => f.frame?.type === type).map((f) => ({ conn: c.id, ...f.frame })),
      );
    },
    stop() {
      for (const c of mux.conns) c.socket.destroy();
    },
  });
}
