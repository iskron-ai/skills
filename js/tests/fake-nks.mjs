// A local stand-in for an OAuth-protected streamable-HTTP MCP server.
//
// It exists so the bridge's whole authorization leg — discovery, dynamic client
// registration, PKCE, the loopback redirect, token exchange, refresh rotation —
// can be watched end to end without a browser and without the product instance.
// The one leg it cannot stand in for is a human deciding to consent; here the
// test plays that part by fetching the authorize URL itself.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const b64url = (b) => Buffer.from(b).toString("base64url");
const sha256 = (s) => createHash("sha256").update(s).digest();
const token = (p) => `${p}-${b64url(randomBytes(9))}`;
// Tokens that carry their own hours, the way a real server's JWTs do.
const jwt = (claims) => [b64url('{"alg":"none"}'), b64url(JSON.stringify(claims)), "sig"].join(".");
const secs = (ms) => Math.floor(ms / 1000); // a JWT keeps whole seconds, so the test does too

// A refresh token the server holds back until the access token is nearly spent:
// carried as a JWT `nbf`, refused in the words of a dead grant if used early.
function mintRefresh(st) {
  if (!st.refreshNotBeforeMs) {
    st.refreshValidFrom = 0;
    return token("refresh");
  }
  const nbf = secs(st.snow() + st.refreshNotBeforeMs);
  st.refreshValidFrom = nbf * 1000; // the server keeps exactly the hour it stamped
  return jwt({ nbf, exp: nbf + 172_800 });
}
// An access token whose own `exp` is the authority; accessExpSkewSec lets a test
// make the claim disagree with the advertised expires_in, as a server may.
function mintAccess(st) {
  if (!st.accessExpSkewSec) return token("access");
  return jwt({ exp: secs(st.snow()) + st.accessTtl - st.accessExpSkewSec });
}

// Ответ iskron_channel(action="register") — дословная форма живого сервера 0.74.0;
// без id (registerNoId) строки id нет вовсе.
const registeredText = (name, id) =>
  `Эта сессия теперь говорит от стояния @tester:${name ?? "(unnamed)"}. Ничего не выпущено и никто не вытеснен — слушающий на этом стоянии слушать не перестал.\n` +
  (id
    ? `  🪪 id этого места — им сужают строку занятости до него одного, и его же берёт отзыв:\n     ${id}\n`
    : "") +
  "\n  Приписывание держится на сессии; …";

// Один ws-кадр сервера клиенту (без маски): FIN + opcode, длина в одной из трёх форм.
function wsFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  let head;
  if (data.length < 126) head = Buffer.from([0x80 | opcode, data.length]);
  else if (data.length < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(data.length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([head, data]);
}

export async function startFakeNks(opts = {}) {
  const st = {
    accessTtl: opts.accessTtl ?? 3600,
    clients: new Map(),
    codes: new Map(),
    access: null,
    refresh: null,
    // A personal access token the server also honours (the bridge's second
    // entrance, no OAuth at all): /mcp takes it as a bearer like any access token.
    pat: opts.pat ?? null,
    sessions: new Set(),
    dead: new Set(),
    // faults the test switches on through /control
    refreshStatus: null, // e.g. 503 (transient) or 400 (definitive)
    refreshError: null,
    refreshMessage: null,
    mcpStatus: null, // force an HTTP status on /mcp
    mcpHangMs: 0, // hold /mcp open past the caller's deadline: the request left, the answer never came
    revokeReplyDelayMs: 0, // revoke: the 4001 close goes out first, the HTTP answer this much later
    refreshDelayMs: opts.refreshDelayMs ?? 0, // widen the window several bridges race in
    codeDelayMs: opts.codeDelayMs ?? 0, // hold the code exchange open, as a slow server does
    registerDelayMs: opts.registerDelayMs ?? 0, // hold dynamic registration open: the window two bridges race in
    refreshNotBeforeMs: opts.refreshNotBeforeMs ?? 0, // hold the refresh token back this long
    keepRefresh: opts.keepRefresh ?? false, // keep the refresh token across a refresh, issuing only a new access token
    accessExpSkewSec: opts.accessExpSkewSec ?? 0, // make the access token's own exp disagree with expires_in
    padBytes: opts.padBytes ?? 0, // make answers bigger than one pipe buffer
    // The server's clock runs this far ahead of the machine's (a customer's
    // clock running behind is the same fact seen from the other side). Every
    // stamped hour and every judgement the fake makes uses this clock, and the
    // Date header on each answer says so out loud, as a real server's does.
    clockSkewMs: opts.clockSkewMs ?? 0,
    tokenPath: opts.tokenPath ?? "/token", // where the token endpoint lives today
    // The posture RFC 9700 recommends for rotating grants: a refresh token
    // presented after it was rotated away is treated as a stolen one, and the
    // whole family dies with it. Off by default — a test asks for it when the
    // point IS what replay costs.
    reuseDetection: opts.reuseDetection ?? false,
    counts: {
      register: 0,
      authorize: 0,
      code_exchange: 0,
      refresh: 0,
      stale_refresh: 0,
      early_refresh: 0,
      mcp: 0,
      register_standing: 0,
      connect: 0,
      list: 0,
      webhooks_added: 0,
      status_posts: 0,
      ws_upgrades: 0,
      attributed_send: 0,
      unattributed: 0,
      header_binds: 0,
    },
    // Привязка, как у настоящей поверхности (#5838): сессия MCP → канал, канал →
    // места по графам. register на том же канале в другом графе ДОБАВЛЯЕТ место,
    // а запись подписывается местом канала в графе самой записи.
    standings: new Map(), // сессия MCP → id канала; убивается вместе с сессией
    channels: new Map(), // id канала → { places: Map(слаг графа → { karta, name }) }
    wsChannel: new Map(), // адрес сокета → id канала
    wsChans: new Map(), // открытый сокет → id канала
    writes: [], // { tool, realm, author } — чем подписана каждая запись фабрики
    placeStatus: new Map(), // standing_id места → строка занятости: она держится у места (#5838)
    // Графы учётки: iskron_realm list печатает оба имени — rN и @owner/slug.
    realms: [
      { short: "r5", canon: "@nks/nks-dev" },
      { short: "r7", canon: "@nks/drugoy" },
      { short: "r2", canon: "@nks/methodology" },
    ],
    // Доска: занятые места по ролям (connect кладёт), комнаты — стояния человека,
    // которые тест объявляет через /control {rooms:[{karta,address}]}.
    places: new Map(), // "karta:name" → { karta, name, incoming }
    hung: new Set(), // сокеты, в которые служба перестала писать (/control {ws_hang})
    placeArgs: [], // поля места, с которыми пришли connect/mint/register (#5174)
    rooms: [],
    webhooks: [], // { id, karta, url, active }
    sends: [], // { karta, standing, text, bound }
    // Сокет стояния: connect выдаёт адрес ws на этом же сервере, апгрейд принимается,
    // hello уходит первым кадром; /control {ws_send, ws_close} гонит кадры и закрытия.
    ws: new Set(),
    messages: new Map(), // id → полный текст: то, что history view=message отдаёт мосту при дочитывании
    status: null, // последняя принятая строка занятости
    wsToken: "tok",
    wsTokens: new Map(), // адрес сокета → имя места; wsNames: открытый сокет → имя места (несколько мостов на одном фейке)
    wsNames: new Map(),
    richTools: false, // /control {richTools:true}: tools/list с пишущими тулами — для проверки приписки момента
    // Сессия открыта credential'ом и умирает вместе с ним (#188 в nks-dev):
    // сменился bearer — старая сессия закрыта. Как сервер отвечает на мёртвый
    // или чужой id — двумя способами, и оба наблюдены в поле: 404 (клиент
    // переинициализируется) либо молча открытая новая сессия, чей id едет в
    // ответе на тот же вызов. Второй способ и есть тот, где запись ложится
    // безавторной до того, как клиент узнал о смене.
    sessionTokens: new Map(),
    sessionFollowsToken: opts.sessionFollowsToken ?? false,
    silentNewSession: opts.silentNewSession ?? false,
    ignoreStandingHeader: opts.ignoreStandingHeader ?? false, // поверхность старше автопривязки: заголовок молча пропускается
    standingRefuseNext: 0, // столько ближайших register отказать проходящим отказом
    standingSeatGoneNext: 0, // столько ближайших register отказать словами «места нет» — сиденье истекло
    // The resource indicator each leg carried. A real server turns this into
    // the token's audience, so it is the only place a test can see what the
    // bridge actually asked to be issued for.
    resources: { authorize: null, code_exchange: null, refresh: null },
  };

  const body = (req) =>
    new Promise((res, rej) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => res(b));
      req.on("error", rej);
    });
  st.snow = () => Date.now() + st.clockSkewMs;

  // ── каналы и места (#5838) ──
  // Граф — в канонической форме @owner/slug, как его печатают кадры и hello; rN и
  // голый слаг разрешаются по списку графов (iskron_realm list отдаёт оба имени).
  const slug = (r) => {
    const t = String(r ?? "").trim();
    if (t.startsWith("@")) return t;
    const known = st.realms.find((x) => x.short === t || x.canon.replace(/^@[^/]+\//, "") === t);
    return known ? known.canon : t;
  };
  const cleanName = (n) => String(n ?? "").trim() || "(unnamed)";
  let chanSeq = 0;
  const place = (karta, name) => ({ karta, name, standing_id: randomUUID() });
  const newChannel = (realm, karta, name) => {
    const id = `ch-${++chanSeq}`;
    // primary — граф места, ради которого канал открыт: его снять нельзя, пока стоят другие (#5186).
    st.channels.set(id, {
      primary: slug(realm),
      places: new Map([[slug(realm), place(karta, name)]]),
    });
    return id;
  };
  /** Канал, который держит место (граф, имя), — или undefined. */
  const channelOfPlace = (realm, name) =>
    [...st.channels].find(([, c]) => c.places.get(slug(realm))?.name === name)?.[0];
  /** register: своё место — привязка к его каналу; новое место в другом графе — рядом на канале сессии. */
  const registerPlace = (sid, realm, rawKarta, rawName) => {
    const karta = String(rawKarta ?? "")
      .trim()
      .replace(/^#/, "");
    const name = cleanName(rawName);
    const seat = channelOfPlace(realm, name);
    if (seat) return (st.standings.set(sid, seat), { added: false });
    const mine = st.channels.get(st.standings.get(sid));
    if (mine && !mine.places.has(slug(realm))) {
      mine.places.set(slug(realm), place(karta, name));
      return { added: true, channel: st.standings.get(sid), karta, name };
    }
    st.standings.set(sid, newChannel(realm, karta, name));
    return { added: false };
  };
  /** Автор записи: место канала сессии в графе записи; граф не назван — первое место канала. */
  const authorOf = (sid, realm) => {
    const c = st.channels.get(st.standings.get(sid));
    if (!c) return undefined;
    if (realm == null || realm === "") return [...c.places.values()][0]?.name;
    return c.places.get(slug(realm))?.name;
  };
  const json = (res, code, obj, headers = {}) => {
    res.writeHead(code, {
      "content-type": "application/json",
      date: new Date(st.snow()).toUTCString(),
      ...headers,
    });
    res.end(JSON.stringify(obj));
  };

  let base = null;
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, base);
    const p = u.pathname;

    // Службу спрашивают о версии, когда сокет рвут: отвечает — служба жива.
    // Молчит по умолчанию (404), как на выкатке; /control {versionUp:true} её поднимает.
    if (p === "/api/version") {
      return st.versionUp ? json(res, 200, { version: "fake-9" }) : json(res, 404, {});
    }

    if (p.startsWith("/channel/status/") && req.method === "POST") {
      const { text, standing_id } = JSON.parse((await body(req)) || "{}");
      if (st.statusDelayMs) {
        // A slow status surface, whose write lands with its answer: a client
        // killed before the answer has published nothing — this is what the
        // harness's stop grace is measured against (r5 #5140, D1).
        await new Promise((r) => setTimeout(r, st.statusDelayMs));
        if (req.socket.destroyed) return;
      }
      if (st.statusGone) return json(res, 404, { error: "no such standing" }); // адрес повернул чужой connect
      if (typeof text !== "string" || [...text].length > 70) {
        return json(res, 422, { error: "busy line too long" });
      }
      st.status = text;
      st.counts.status_posts++;
      // Строка держится у места: со standing_id — у одного места канала, без него — у всех (#5838).
      const chan = st.channels.get(st.wsChannel.get(p.slice("/channel/status/".length)));
      for (const pl of chan?.places.values() ?? [])
        if (!standing_id || pl.standing_id === standing_id)
          st.placeStatus.set(pl.standing_id, text);
      return json(res, 200, { ok: true });
    }

    if (p === "/control") {
      const patch = JSON.parse((await body(req)) || "{}");
      if (typeof patch.ws_send === "string") {
        for (const sock of st.ws) if (!st.hung.has(sock)) sock.write(wsFrame(0x1, patch.ws_send));
      }
      // Очередь разом (повтор платформы после переподключения): кадры по порядку, одним запросом.
      if (Array.isArray(patch.ws_send_many)) {
        for (const text of patch.ws_send_many)
          for (const sock of st.ws) if (!st.hung.has(sock)) sock.write(wsFrame(0x1, text));
      }
      // Подвисшее соединение (#5380): сокет открыт, но служба больше ничего в него не пишет — ни пинга, ни кадра, ни закрытия.
      if (patch.ws_hang) for (const sock of st.ws) st.hung.add(sock);
      if (Number.isInteger(patch.ws_refuse)) st.wsRefuse = patch.ws_refuse; // один раз: следующий апгрейд закрывается этим кодом, дальнейшие принимаются
      if (Number.isInteger(patch.ws_close)) {
        for (const sock of st.ws) {
          sock.write(wsFrame(0x8, Buffer.from([patch.ws_close >> 8, patch.ws_close & 0xff])));
          setTimeout(() => sock.end(), 200).unref();
        }
      }
      if (patch.kill_session) {
        for (const s of st.sessions) st.dead.add(s);
        st.sessions.clear();
      }
      for (const k of [
        "richTools",
        "versionUp",
        "refreshStatus",
        "refreshError",
        "refreshMessage",
        "mcpStatus",
        "mcpHangMs",
        "revokeReplyDelayMs",
        "accessTtl",
        "refreshDelayMs",
        "reuseDetection",
        "tokenPath",
        "sessionFollowsToken",
        "silentNewSession",
        "standingRefuseNext",
        "standingSeatGoneNext",
        "registerNoId", // ответ register без standing_id — id места мосту не известен
        "adminChannelSelf", // tools/list объявляет у iskron_admin параметр channel
        "rooms",
        "boardText",
        "hooksText",
        "helloPending", // what the next hello says was waiting in the queue
        "statusDelayMs", // hold the status POST open this long before answering
      ]) {
        if (k in patch) st[k] = patch[k];
      }
      if (patch.message_full) st.messages.set(patch.message_full.id, patch.message_full.text);
      // Вимарша posed_to роли в графе: хук channel:self доставляет её внутри службы —
      // в сокет каждого канала, где у роли есть место этого графа, с to_standing_id места.
      if (patch.posed_to) {
        const { realm, karta, text, id } = patch.posed_to;
        const canon = slug(realm);
        const armed = st.webhooks.some(
          (w) => w.channel === "self" && w.realm === canon && w.karta === String(karta) && w.active,
        );
        for (const [chanId, c] of armed ? st.channels : []) {
          const pl = c.places.get(canon);
          if (!pl || pl.karta !== String(karta)) continue;
          const frame = {
            type: "message",
            id: id ?? token("posed"),
            received_at: new Date().toISOString(),
            stale: false,
            content_type: "text/plain",
            body_chars: text.length,
            to_standing_id: pl.standing_id,
            to_standing: `@tester:${pl.name}`,
            realm: canon,
            karta_seq: Number(pl.karta),
            body: text,
          };
          for (const sock of st.ws)
            if (st.wsChans.get(sock) === chanId) sock.write(wsFrame(0x1, JSON.stringify(frame)));
        }
      }
      // Чужое живое место на доске — как если бы его держал мост другой сессии.
      if (Array.isArray(patch.webhooks)) {
        for (const w of patch.webhooks) {
          const wakes = [...st.places.values()].find((pl) => pl.name === w.wakes);
          st.webhooks.push({
            id: 100 + st.webhooks.length,
            karta: String(w.karta),
            url: wakes?.incoming ?? "http://x/none",
            active: true,
          });
        }
      }
      if (Array.isArray(patch.places)) {
        for (const pl of patch.places) {
          st.places.set(`${pl.karta}:${pl.name}`, {
            karta: String(pl.karta),
            name: pl.name,
            incoming: `${base}/api/channel/in/mailbox-${pl.name}`,
            listening: pl.listening !== false,
            pending: pl.pending ?? 0, // «не доставлено N» on the board
            id: pl.id ?? null, // «id <uuid>» under the place on the board
          });
        }
      }
      if ("connect_refuse_ttl" in patch) st.connectRefuseTtl = patch.connect_refuse_ttl || null; // отказ окну простоя на connect
      if ("send_conflict" in patch) st.sendConflict = patch.send_conflict || null; // текст отказа 409 не о безавторности
      if ("statusGone" in patch) st.statusGone = !!patch.statusGone; // статусный адрес повернули
      if (patch.revoke_access) st.access = null;
      if (patch.rotate_access) st.access = mintAccess(st); // сосед провернул грант: старый bearer больше не принимается
      if (patch.drop_standings) st.standings.clear(); // платформа потеряла привязки при живых сессиях mcp
      if (patch.forget_clients) st.clients.clear(); // as if the server expired the dynamic registration
      return json(res, 200, { counts: st.counts });
    }

    if (p === "/.well-known/oauth-protected-resource/mcp") {
      return json(res, 200, {
        resource: `${base}/mcp`,
        authorization_servers: [base],
        scopes_supported: ["nks"],
      });
    }
    if (p === "/.well-known/oauth-authorization-server") {
      return json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}${st.tokenPath}`,
        registration_endpoint: `${base}/register`,
        code_challenge_methods_supported: ["S256"],
      });
    }

    if (p === "/register" && req.method === "POST") {
      st.counts.register++;
      if (st.registerDelayMs) await new Promise((r) => setTimeout(r, st.registerDelayMs));
      const reg = JSON.parse(await body(req));
      const id = token("client");
      st.clients.set(id, reg);
      return json(res, 201, { client_id: id, redirect_uris: reg.redirect_uris });
    }

    // The consent screen a human would click through — answered straight away.
    if (p === "/authorize") {
      st.counts.authorize++;
      const q = u.searchParams;
      st.resources.authorize = q.get("resource");
      if (!st.clients.has(q.get("client_id"))) return json(res, 400, { error: "unknown client" });
      const code = token("code");
      st.codes.set(code, {
        challenge: q.get("code_challenge"),
        redirect_uri: q.get("redirect_uri"),
        client_id: q.get("client_id"),
      });
      const back = new URL(q.get("redirect_uri"));
      back.searchParams.set("code", code);
      back.searchParams.set("state", q.get("state"));
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }

    if (p === st.tokenPath && req.method === "POST") {
      const f = new URLSearchParams(await body(req));
      if (f.get("grant_type") === "authorization_code") {
        st.counts.code_exchange++;
        if (st.codeDelayMs) await new Promise((r) => setTimeout(r, st.codeDelayMs));
        st.resources.code_exchange = f.get("resource");
        const c = st.codes.get(f.get("code"));
        if (!c)
          return json(res, 400, { error: "invalid_grant", error_description: "unknown code" });
        st.codes.delete(f.get("code"));
        if (b64url(sha256(f.get("code_verifier") || "")) !== c.challenge) {
          return json(res, 400, { error: "invalid_grant", error_description: "PKCE mismatch" });
        }
        if (f.get("redirect_uri") !== c.redirect_uri) {
          return json(res, 400, {
            error: "invalid_grant",
            error_description: "redirect_uri mismatch",
          });
        }
        // A code is bound to the client it was issued to (RFC 6749 §4.1.3).
        if (f.get("client_id") !== c.client_id) {
          return json(res, 400, {
            error: "invalid_grant",
            error_description: "client_id mismatch",
          });
        }
        st.access = mintAccess(st);
        st.refresh = mintRefresh(st);
        return json(res, 200, {
          access_token: st.access,
          refresh_token: st.refresh,
          expires_in: st.accessTtl,
          token_type: "Bearer",
        });
      }
      if (f.get("grant_type") === "refresh_token") {
        st.counts.refresh++;
        st.resources.refresh = f.get("resource");
        if (st.refreshValidFrom && st.snow() < st.refreshValidFrom) {
          st.counts.early_refresh++;
          return json(res, 400, {
            error: "invalid_grant",
            error_description: "token not yet valid",
          });
        }
        if (st.refreshStatus) {
          return json(res, st.refreshStatus, {
            error: st.refreshError || "server_error",
            ...(st.refreshMessage ? { message: st.refreshMessage } : {}),
          });
        }
        if (f.get("refresh_token") !== st.refresh) {
          st.counts.stale_refresh++;
          if (st.reuseDetection) {
            st.access = null;
            st.refresh = null;
          }
          return json(res, 400, {
            error: "invalid_grant",
            error_description: "stale refresh token",
          });
        }
        if (st.refreshDelayMs) await new Promise((r) => setTimeout(r, st.refreshDelayMs));
        if (f.get("refresh_token") !== st.refresh) {
          // rotated while we were slow
          st.counts.stale_refresh++;
          if (st.reuseDetection) {
            st.access = null;
            st.refresh = null;
          }
          return json(res, 400, {
            error: "invalid_grant",
            error_description: "stale refresh token",
          });
        }
        st.access = mintAccess(st);
        if (!st.keepRefresh) st.refresh = mintRefresh(st); // rotation — unless this server keeps it
        return json(res, 200, {
          access_token: st.access,
          refresh_token: st.refresh,
          expires_in: st.accessTtl,
          token_type: "Bearer",
        });
      }
      return json(res, 400, { error: "unsupported_grant_type" });
    }

    if (p === "/mcp" && req.method === "POST") {
      st.counts.mcp++;
      if (st.mcpHangMs) await new Promise((r) => setTimeout(r, st.mcpHangMs));
      if (st.mcpStatus) {
        res.writeHead(st.mcpStatus);
        return res.end("forced fault");
      }
      const bearer = (req.headers.authorization || "").replace(/^Bearer /, "");
      const byPat = !!st.pat && bearer === st.pat;
      if (!byPat && (!st.access || bearer !== st.access)) {
        return json(
          res,
          401,
          { error: "unauthorized" },
          {
            "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
          },
        );
      }
      let sid = req.headers["mcp-session-id"];
      const msg = JSON.parse(await body(req));
      const extra = {};
      if (
        sid &&
        st.sessionFollowsToken &&
        st.sessionTokens.has(sid) &&
        st.sessionTokens.get(sid) !== bearer
      ) {
        st.dead.add(sid);
        st.sessions.delete(sid); // credential сменился — сессия закрыта
      }
      if (sid && st.dead.has(sid) && msg.method !== "initialize") {
        if (!st.silentNewSession) {
          res.writeHead(404);
          return res.end("session expired");
        }
        // Молча открытая новая сессия: вызов исполняется в ней, её id едет в ответе.
        sid = token("session");
        st.sessions.add(sid);
        st.sessionTokens.set(sid, bearer);
        extra["mcp-session-id"] = sid;
      }

      if (!sid && msg.method !== "initialize") {
        // Как настоящая поверхность: вызов вне рукопожатия без сессии — 400.
        return json(res, 400, { error: "no Mcp-Session-Id on this request" });
      }

      if (msg.method === "initialize") {
        const fresh = token("session");
        st.sessions.add(fresh);
        st.sessionTokens.set(fresh, bearer);
        // Автопривязка стояния при открытии сессии (#3800 в nks-dev): заголовок
        // «граф карта имя» привязывает сессию прежде ответа на рукопожатие.
        const hdr = req.headers["x-nks-standing"];
        if (hdr && !st.ignoreStandingHeader) {
          const parts = String(hdr).trim().split(/\s+/);
          if (parts.length === 3) {
            registerPlace(fresh, parts[0], parts[1], parts[2]);
            st.counts.header_binds++;
          }
        }
        return json(
          res,
          200,
          {
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              serverInfo: { name: "fake-nks", version: "0" },
            },
          },
          { "mcp-session-id": fresh },
        );
      }
      if (msg.id === undefined || msg.id === null) {
        res.writeHead(202, extra);
        return res.end();
      }
      if (msg.method === "tools/list") {
        return json(
          res,
          200,
          {
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              tools: st.adminChannelSelf
                ? [
                    // Схема тула хуков объявляет channel — хук на канал ({"channel":"self"}).
                    {
                      name: "iskron_admin",
                      description: "Администрирование: хуки роли.",
                      inputSchema: {
                        type: "object",
                        properties: {
                          action: { type: "string" },
                          realm: { type: "string" },
                          node_id: { type: "string" },
                          url: { type: "string" },
                          channel: { type: "string" },
                        },
                      },
                    },
                  ]
                : st.richTools
                  ? [
                      {
                        name: "iskron_orient",
                        description: "Войдите в граф.",
                        inputSchema: { type: "object" },
                      },
                      {
                        name: "iskron_add_vimarsha",
                        description: "Создай вопрошание.",
                        inputSchema: { type: "object" },
                      },
                      {
                        name: "iskron_batch",
                        description: "Атомарная дельта.",
                        inputSchema: { type: "object" },
                      },
                      {
                        name: "iskron_channel",
                        description: "Живой канал роли.",
                        inputSchema: { type: "object" },
                      },
                    ]
                  : [{ name: "nks_orient" }],
            },
          },
          extra,
        );
      }
      // Стояние делателя, смоделированное так, как его держит настоящая
      // поверхность: коррелятор писателя — идентификатор сессии MCP. Новая
      // сессия — другой писатель, и её память о регистрации собрана вместе со
      // старой. Ровно поэтому перерегистрация — забота моста: он один видит
      // смену id и один помнит выведенное имя.
      if (msg.method === "tools/call" && msg.params?.name === "iskron_channel") {
        const a = msg.params.arguments ?? {};
        if (a.action === "register") {
          if (st.standingSeatGoneNext > 0) {
            st.standingSeatGoneNext--;
            return json(
              res,
              200,
              {
                jsonrpc: "2.0",
                id: msg.id,
                result: {
                  isError: true,
                  content: [
                    {
                      type: "text",
                      text: `Отказано (404): no such standing «${a.name ?? ""}» — take it with connect`,
                    },
                  ],
                },
              },
              extra,
            );
          }
          if (st.standingRefuseNext > 0) {
            st.standingRefuseNext--;
            return json(
              res,
              200,
              {
                jsonrpc: "2.0",
                id: msg.id,
                result: {
                  isError: true,
                  content: [
                    {
                      type: "text",
                      text: "Отказано (503): контур временно недоступен, повтори позже",
                    },
                  ],
                },
              },
              extra,
            );
          }
          st.counts.register_standing++;
          st.placeArgs.push({
            action: "register",
            name: a.name,
            model: a.model,
            attrs: a.attrs,
            ...("satellite_of" in a ? { satellite_of: a.satellite_of } : {}), // тело как пришло (#6064)
          });
          const reg = registerPlace(sid, a.realm, a.karta, a.name);
          if (reg.added) {
            // Место рядом на канале: на доске его графа, слушает — если сокет канала открыт.
            const listening = [...st.ws].some((s) => st.wsChans.get(s) === reg.channel);
            st.places.set(`${reg.karta}:${reg.name}`, {
              karta: reg.karta,
              name: reg.name,
              realm: a.realm,
              incoming: null, // своего входящего адреса у места другого графа нет — он у канала (#5838)
              listening,
            });
          }
          return json(
            res,
            200,
            {
              jsonrpc: "2.0",
              id: msg.id,
              // Ответ тула — проза, как на живом сервере 0.74.0: id места строкой после
              // «🪪 id этого места». Нового hello нет: сокет канала сам несёт кадры нового места.
              result: {
                content: [
                  {
                    type: "text",
                    text: registeredText(
                      a.name,
                      st.registerNoId
                        ? null
                        : st.channels.get(st.standings.get(sid))?.places.get(slug(a.realm))
                            ?.standing_id,
                    ),
                  },
                ],
              },
            },
            extra,
          );
        }
        if (a.action === "list") {
          st.counts.list++;
          if (typeof st.boardText === "string") {
            return json(
              res,
              200,
              {
                jsonrpc: "2.0",
                id: msg.id,
                result: { content: [{ type: "text", text: st.boardText }] },
              },
              extra,
            );
          }
          // Доска — графа из вызова: место без графа (объявленное пробой) видно на любой.
          const shown = [...st.places.values()].filter(
            (p) => p.realm == null || slug(p.realm) === slug(a.realm),
          );
          const lines = [`Каналы (${shown.length + st.rooms.length}):`];
          for (const p of shown) {
            // Форма живой доски (iskron_channel list, сервер 0.43): строка места,
            // строка занятости «💬 «…»» и строка входящего адреса «📥».
            lines.push(
              `  #${p.karta} 👨‍💻 Роль 能 · @tester:${p.name} — живой · простой 6h · ${p.pending ? `не доставлено ${p.pending} · ` : ""}${p.listening ? "слушает" : "не слушает"} · сокет был 2026-09-08T16:43:28.211106Z · открыл @tester`,
            );
            lines.push(`     💬 «${p.status ?? "на вахте"}» · 2026-09-08T16:08:56.121391Z`);
            if (p.incoming) lines.push(`     📥 ${p.incoming}`);
            if (p.id) lines.push(`     id ${p.id}`);
          }
          for (const r of st.rooms) {
            lines.push(
              `  #${r.karta} 👑 Человек 主 · ${r.address} — живой · простой 6h · слушает · открыл @tester`,
            );
            lines.push(`     📥 ${base}/api/channel/in/room-${r.karta}`);
          }
          return json(
            res,
            200,
            {
              jsonrpc: "2.0",
              id: msg.id,
              result: { content: [{ type: "text", text: lines.join("\n") }] },
            },
            extra,
          );
        }
        if (
          (a.action === "connect" || a.action === "mint") &&
          st.connectRefuseTtl &&
          a.ttl_seconds != null
        ) {
          // Контур отвергает окно простоя своими словами — проба не знает, какими (/control {connect_refuse_ttl}).
          st.counts.ttl_refused = (st.counts.ttl_refused ?? 0) + 1;
          return json(
            res,
            200,
            {
              jsonrpc: "2.0",
              id: msg.id,
              result: { isError: true, content: [{ type: "text", text: st.connectRefuseTtl }] },
            },
            extra,
          );
        }
        if (a.action === "connect" || a.action === "mint") {
          st.placeArgs.push({
            action: a.action,
            name: a.name,
            model: a.model,
            attrs: a.attrs,
            ttl_seconds: a.ttl_seconds,
            ...("satellite_of" in a ? { satellite_of: a.satellite_of } : {}), // тело как пришло (#6064)
          });
          st.counts.connect++;
          st.wsToken = token("ws"); // как у настоящей поверхности: сокет показан один раз и всякий раз новый
          // wsTokens: чьё место откроет этот адрес — доска и revoke судят по месту, не по мосту (ниже, именем без полей)
          // The real surface prints the role as a bare number whatever the caller wrote («#931» is lawful).
          const karta = String(a.karta).trim().replace(/^#/, "");
          const name = String(a.name ?? "").trim();
          // Канал места: тот же, если место уже есть (адрес сокета новый), иначе новый.
          const chan =
            channelOfPlace(a.realm, cleanName(a.name)) ??
            newChannel(a.realm, karta, cleanName(a.name));
          st.standings.set(sid, chan);
          st.wsChannel.set(st.wsToken, chan);
          st.wsTokens.set(st.wsToken, name);
          st.places.set(`${karta}:${name}`, {
            karta,
            name,
            realm: a.realm,
            incoming: `${base}/api/channel/in/mailbox-${a.name ?? "unnamed"}`,
            listening: true,
          });
          const wsUrl = `${base.replace(/^http:/, "ws:")}/channel/ws/${st.wsToken}`;
          return json(
            res,
            200,
            {
              jsonrpc: "2.0",
              id: msg.id,
              result: {
                content: [
                  {
                    type: "text",
                    text:
                      `Место занято: ${a.name ?? "(unnamed)"}.\n` +
                      `📥 входящий: ${base}/api/channel/in/mailbox-${a.name ?? "unnamed"}\n` +
                      `сокет (показан один раз): ${wsUrl}\n` +
                      `статус: ${base}/channel/status/${st.wsToken}`,
                  },
                ],
              },
            },
            extra,
          );
        }
        if (a.action === "revoke") {
          const name = String(a.standing ?? "").replace(/^.*:/, "");
          // Снятие — по id места; основное место канала не снимается, пока на
          // канале стоят места других графов (#5186) — как у настоящей поверхности.
          const target = st.channels.get(channelOfPlace(a.realm, name));
          if (target && target.primary === slug(a.realm) && target.places.size > 1) {
            st.counts.revoke_refused = (st.counts.revoke_refused ?? 0) + 1;
            return json(
              res,
              200,
              {
                jsonrpc: "2.0",
                id: msg.id,
                result: {
                  isError: true,
                  content: [
                    {
                      type: "text",
                      text: `Отказано (409): «${name}» — основное место канала, на нём стоят места других графов (${target.places.size - 1}); сначала сними их.`,
                    },
                  ],
                },
              },
              extra,
            );
          }
          const had = st.places.delete(`${String(a.karta).replace(/^#/, "")}:${name}`);
          // Место снимается с канала; канал без мест закрыт, с местами других графов — жив (#5838).
          const chan =
            channelOfPlace(a.realm, name) ??
            [...st.channels].find(([, c]) =>
              [...c.places.values()].some((p) => p.name === name),
            )?.[0];
          const places = st.channels.get(chan)?.places;
          for (const [r, p] of places ?? [])
            if (p.name === name && (!places.has(slug(a.realm)) || r === slug(a.realm)))
              places.delete(r);
          const empty = !st.channels.get(chan)?.places.size;
          // As the real surface: only the revoked place's socket is closed — the
          // socket of another place the same bridge holds stays up (#5154).
          for (const sock of st.ws) {
            if ((st.wsNames.get(sock) ?? name) !== name) continue;
            if (chan && st.wsChans.get(sock) === chan && !empty) continue;
            sock.write(wsFrame(0x8, Buffer.from([4001 >> 8, 4001 & 0xff])));
            setTimeout(() => sock.end(), 100).unref();
          }
          if (chan && empty) {
            st.channels.delete(chan);
            for (const [sid2, bound] of st.standings) if (bound === chan) st.standings.delete(sid2);
          }
          // Как у настоящей поверхности: закрытие сокета уходит раньше ответа по HTTP.
          if (st.revokeReplyDelayMs) await new Promise((r) => setTimeout(r, st.revokeReplyDelayMs));
          return json(
            res,
            200,
            {
              jsonrpc: "2.0",
              id: msg.id,
              result: had
                ? {
                    content: [
                      {
                        type: "text",
                        text: `Канал #${a.karta} · @tester:${name} закрыт — место «${name}». Оба его адреса теперь отвечают 404.`,
                      },
                    ],
                  }
                : {
                    isError: true,
                    content: [
                      {
                        type: "text",
                        text: `Отказано: у #${a.karta} нет стояния с именем «${name}»`,
                      },
                    ],
                  },
            },
            extra,
          );
        }
        if (a.action === "history" && a.view === "message") {
          const full = st.messages.get(a.message);
          const text = full
            ? `СООБЩЕНИЕ ЦЕЛИКОМ (text/plain)\n${full}\nПровенанс, как платформа наблюдала его ТОГДА, — судят по нему, читают по именам выше:\n{"auth":"oidc"}`
            : "Отказано (404): такого слова нет";
          return json(
            res,
            200,
            {
              jsonrpc: "2.0",
              id: msg.id,
              result: { ...(full ? {} : { isError: true }), content: [{ type: "text", text }] },
            },
            extra,
          );
        }
        if (a.action === "send") {
          const bound = authorOf(sid, a.realm);
          // Отказ 409 иного рода (/control {send_conflict}): сессия привязана, отказ не о безавторности.
          if (bound && st.sendConflict) {
            st.counts.send_conflicts = (st.counts.send_conflicts ?? 0) + 1;
            return json(
              res,
              200,
              {
                jsonrpc: "2.0",
                id: msg.id,
                result: { isError: true, content: [{ type: "text", text: st.sendConflict }] },
              },
              extra,
            );
          }
          if (!bound) {
            st.counts.unattributed++;
            return json(
              res,
              200,
              {
                jsonrpc: "2.0",
                id: msg.id,
                result: {
                  isError: true,
                  content: [
                    {
                      type: "text",
                      text: "Ошибка: Отказано (409): Эта сессия не зарегистрирована ни за каким стоянием, поэтому слово пришло бы без автора и читалось бы как слова владельца учётки.",
                    },
                  ],
                },
              },
              extra,
            );
          }
          st.counts.attributed_send++;
          st.sends.push({
            karta: String(a.karta),
            standing: a.standing ?? null,
            text: a.text ?? "",
            bound,
          });
          return json(
            res,
            200,
            {
              jsonrpc: "2.0",
              id: msg.id,
              result: { content: [{ type: "text", text: `принято стоянием ${bound}` }] },
            },
            extra,
          );
        }
      }
      // Список графов учётки — ровно та форма, что отдаёт живой тул iskron_realm(action="list").
      if (msg.method === "tools/call" && msg.params?.name === "iskron_realm") {
        st.counts.realm_list = (st.counts.realm_list ?? 0) + 1;
        const lines = [
          `Доступные графы (${st.realms.length}) — адресуй их как @owner/slug или rN; обе формы показаны ниже:`,
          "",
          "▸ @nks (организация)",
        ];
        for (const r of st.realms)
          lines.push(
            `    ${r.canon}  ${r.short}  ${r.canon.replace(/^@[^/]+\//, "")} · 2026-09-23`,
          );
        return json(
          res,
          200,
          {
            jsonrpc: "2.0",
            id: msg.id,
            result: { content: [{ type: "text", text: lines.join("\n") }] },
          },
          extra,
        );
      }
      // Хуки роли: list_webhooks печатает по строке на хук с тем, кого он будит;
      // add_webhook кладёт новый — так мост видит, стоит ли уже хук на его стояние.
      if (msg.method === "tools/call" && msg.params?.name === "iskron_admin") {
        const a = msg.params.arguments ?? {};
        if (a.action === "list_webhooks") {
          if (typeof st.hooksText === "string") {
            return json(
              res,
              200,
              {
                jsonrpc: "2.0",
                id: msg.id,
                result: { content: [{ type: "text", text: st.hooksText }] },
              },
              extra,
            );
          }
          const mine = st.webhooks.filter(
            (w) => String(w.karta) === String(a.node_id) && (!w.realm || w.realm === slug(a.realm)),
          );
          // Пустой список поверхность печатает без заголовка — наблюдено на mcp.iskron.ru.
          if (!mine.length)
            return json(
              res,
              200,
              {
                jsonrpc: "2.0",
                id: msg.id,
                result: {
                  content: [
                    { type: "text", text: `Для #${a.node_id} вебхуки не зарегистрированы.` },
                  ],
                },
              },
              extra,
            );
          const lines = [`Вебхуки для #${a.node_id} (${mine.length}):`];
          for (const w of mine) {
            const wakes =
              w.channel === "self"
                ? [...st.places.values()].find(
                    (p) => p.karta === w.karta && p.realm != null && slug(p.realm) === w.realm,
                  )
                : [...st.places.values()].find((p) => p.incoming === w.url);
            lines.push(
              `  #${w.id} → doer:#${w.karta} — ${w.active ? "активен" : "пауза"} [minimal]`,
            );
            lines.push(
              `     будит сейчас (${wakes ? 1 : 0}): ${wakes ? `@tester:${wakes.name}` : "никого"}`,
            );
          }
          return json(
            res,
            200,
            {
              jsonrpc: "2.0",
              id: msg.id,
              result: { content: [{ type: "text", text: lines.join("\n") }] },
            },
            extra,
          );
        }
        if (a.action === "add_webhook") {
          // Нулевой срок — ход update_webhook («0 снимает срок»); на добавлении контур его отвергает — слово архитектора в #5380, текст отказа здесь условный.
          if (a.ttl_seconds === 0)
            return json(
              res,
              200,
              {
                jsonrpc: "2.0",
                id: msg.id,
                result: {
                  isError: true,
                  content: [{ type: "text", text: "Отказано (422): ttl_seconds must be positive" }],
                },
              },
              extra,
            );
          st.counts.webhooks_added++;
          const id = 100 + st.webhooks.length;
          // {"channel":"self"} — хук на канал: доставка внутри службы местам роли этого графа (#5838).
          if (a.channel === "self") {
            st.webhooks.push({
              id,
              karta: String(a.node_id),
              channel: "self",
              realm: slug(a.realm),
              active: true,
            });
            return json(
              res,
              200,
              {
                jsonrpc: "2.0",
                id: msg.id,
                result: {
                  content: [{ type: "text", text: `Вебхук #${id} создан → канал (self)` }],
                },
              },
              extra,
            );
          }
          st.webhooks.push({ id, karta: String(a.node_id), url: a.url, active: true });
          return json(
            res,
            200,
            {
              jsonrpc: "2.0",
              id: msg.id,
              result: { content: [{ type: "text", text: `Вебхук #${id} создан → ${a.url}` }] },
            },
            extra,
          );
        }
      }
      // Пишущая фабрика графа: пишет и без привязки, но метит запись безавторной —
      // так ведёт себя настоящая поверхность (write_unattributed_several_standings).
      if (msg.method === "tools/call" && /^iskron_(add_|update)/.test(msg.params?.name ?? "")) {
        const realm = msg.params.arguments?.realm;
        const bound = authorOf(sid, realm); // место канала в графе записи (#5838)
        st.writes.push({ tool: msg.params.name, realm, author: bound ?? null });
        if (!bound) st.counts.unattributed++;
        return json(
          res,
          200,
          {
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              content: [
                {
                  type: "text",
                  text: bound
                    ? `Создан узел #1 (автор: ${bound})`
                    : "Создан узел #1\n⚠ write_unattributed_several_standings: This write carried no author",
                },
              ],
            },
          },
          extra,
        );
      }
      return json(
        res,
        200,
        {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            ok: true,
            method: msg.method,
            ...(st.padBytes ? { pad: "x".repeat(st.padBytes) } : {}),
          },
        },
        extra,
      );
    }

    res.writeHead(404);
    res.end();
  });

  // Минимальный ws-сервер: апгрейд по адресу сокета стояния, hello первым кадром,
  // дальше кадры и закрытия по /control. Входящее от клиента не разбирается —
  // сторона моста ничего не шлёт, кроме ответов на закрытие.
  server.on("upgrade", (req, socket) => {
    const u = new URL(req.url, base);
    if (!u.pathname.startsWith("/channel/ws/")) return socket.destroy();
    const accept = createHash("sha1")
      .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    if (st.wsRefuse) {
      // Платформа больше не знает токена (протухшая запись держания): апгрейд
      // принят, и первым кадром идёт закрытие кодом мёртвого токена.
      socket.end(wsFrame(0x8, Buffer.from([st.wsRefuse >> 8, st.wsRefuse & 0xff])));
      setTimeout(() => socket.destroy(), 200).unref(); // не держать сервер полуоткрытым сокетом
      st.wsRefuse = 0;
      return;
    }
    st.ws.add(socket);
    st.counts.ws_upgrades++;
    // Доска читает по сокету МЕСТА: открыт — его место слушает; адрес без места
    // (сокет из окружения) — по-старому, все места разом.
    const placeName = st.wsTokens.get(u.pathname.slice("/channel/ws/".length));
    const chan = st.wsChannel.get(u.pathname.slice("/channel/ws/".length));
    if (chan) st.wsChans.set(socket, chan);
    const ofPlace = (pl) => placeName === undefined || pl.name === placeName;
    if (placeName !== undefined) st.wsNames.set(socket, placeName);
    for (const pl of st.places.values()) if (ofPlace(pl)) pl.listening = true;
    socket.on("end", () => socket.destroy()); // сокет апгрейда полуоткрыт: без этого «close» после смерти моста не приходит
    socket.on("close", () => {
      st.ws.delete(socket);
      st.wsNames.delete(socket);
      st.wsChans.delete(socket);
      // Последний сокет места закрыт — «не слушает» сразу (прежние серверы держали «слушает» ещё ~40 с;
      // такое окно проба ставит сама через /control {places: [{…, listening: true}]}.
      const stillHeld =
        placeName === undefined
          ? st.ws.size > 0
          : [...st.ws].some((s) => st.wsNames.get(s) === placeName);
      if (!stillHeld) for (const pl of st.places.values()) if (ofPlace(pl)) pl.listening = false;
    });
    socket.on("error", () => st.ws.delete(socket));
    socket.write(
      wsFrame(
        0x1,
        JSON.stringify({
          type: "hello",
          pending: st.helloPending ?? 0,
          // Все места канала — как у настоящей поверхности (#5838).
          // Форма наблюдена на живом сервере (мост 6.11.0).
          standings: [...(st.channels.get(chan)?.places ?? [])].map(([realm, p]) => ({
            karta_seq: Number(p.karta),
            pending: 0,
            realm,
            standing: `@tester:${p.name}`,
            standing_id: p.standing_id,
          })),
          ping_interval_seconds: opts.helloPingS ?? (opts.pingMs ? opts.pingMs / 1000 : 30),
        }),
      ),
    );
    // Протокольный пинг, как у контура (opcode 9, пустая нагрузка): только когда проба его просит.
    if (opts.pingMs) {
      const t = setInterval(() => {
        if (socket.destroyed) return clearInterval(t);
        if (!st.hung.has(socket)) socket.write(wsFrame(0x9, Buffer.alloc(0)));
      }, opts.pingMs);
      t.unref();
    }
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    mcpUrl: `${base}/mcp`,
    state: st,
    control: (patch) =>
      fetch(`${base}/control`, { method: "POST", body: JSON.stringify(patch) }).then((r) =>
        r.json(),
      ),
    // Открытый ws держит сервер живым: сперва рвём захваченные сокеты, иначе
    // close() ждёт их вечно, а с ним и проба.
    stop: () => {
      for (const s of st.ws) s.destroy();
      st.ws.clear();
      server.closeAllConnections?.();
      return new Promise((r) => server.close(r));
    },
  };
}
