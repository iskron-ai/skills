// A local stand-in for an OAuth-protected streamable-HTTP MCP server.
//
// It exists so the bridge's whole authorization leg — discovery, dynamic client
// registration, PKCE, the loopback redirect, token exchange, refresh rotation —
// can be watched end to end without a browser and without the product instance.
// The one leg it cannot stand in for is a human deciding to consent; here the
// test plays that part by fetching the authorize URL itself.

import { createHash, randomBytes } from "node:crypto";
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
      attributed_send: 0,
      unattributed: 0,
      header_binds: 0,
    },
    standings: new Map(), // сессия MCP → имя стояния; убивается вместе с сессией
    // Доска: занятые места по ролям (connect кладёт), комнаты — стояния человека,
    // которые тест объявляет через /control {rooms:[{karta,address}]}.
    places: new Map(), // "karta:name" → { karta, name, incoming }
    rooms: [],
    webhooks: [], // { id, karta, url, active }
    sends: [], // { karta, standing, text, bound }
    // Сокет стояния: connect выдаёт адрес ws на этом же сервере, апгрейд принимается,
    // hello уходит первым кадром; /control {ws_send, ws_close} гонит кадры и закрытия.
    ws: new Set(),
    messages: new Map(), // id → полный текст: то, что history view=message отдаёт мосту при дочитывании
    status: null, // последняя принятая строка занятости
    wsToken: "tok",
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
      const { text } = JSON.parse((await body(req)) || "{}");
      if (typeof text !== "string" || [...text].length > 70) {
        return json(res, 422, { error: "busy line too long" });
      }
      st.status = text;
      st.counts.status_posts++;
      return json(res, 200, { ok: true });
    }

    if (p === "/control") {
      const patch = JSON.parse((await body(req)) || "{}");
      if (typeof patch.ws_send === "string") {
        for (const sock of st.ws) sock.write(wsFrame(0x1, patch.ws_send));
      }
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
        "accessTtl",
        "refreshDelayMs",
        "reuseDetection",
        "tokenPath",
        "sessionFollowsToken",
        "silentNewSession",
        "standingRefuseNext",
        "rooms",
        "boardText",
        "hooksText",
      ]) {
        if (k in patch) st[k] = patch[k];
      }
      if (patch.message_full) st.messages.set(patch.message_full.id, patch.message_full.text);
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
          });
        }
      }
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
            st.standings.set(fresh, parts[2]);
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
              tools: st.richTools
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
          st.standings.set(sid, a.name ?? "(unnamed)");
          return json(
            res,
            200,
            {
              jsonrpc: "2.0",
              id: msg.id,
              result: { content: [{ type: "text", text: `зарегистрировано: ${a.name}` }] },
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
          const lines = [`Каналы (${st.places.size + st.rooms.length}):`];
          for (const p of st.places.values()) {
            // Форма живой доски (iskron_channel list, сервер 0.43): строка места,
            // строка занятости «💬 «…»» и строка входящего адреса «📥».
            lines.push(
              `  #${p.karta} 👨‍💻 Роль 能 · @tester:${p.name} — живой · простой 6h · ${p.listening ? "слушает" : "не слушает"} · сокет был 2026-09-08T16:43:28.211106Z · открыл @tester`,
            );
            lines.push(`     💬 «${p.status ?? "на вахте"}» · 2026-09-08T16:08:56.121391Z`);
            lines.push(`     📥 ${p.incoming}`);
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
        if (a.action === "connect" || a.action === "mint") {
          st.counts.connect++;
          st.wsToken = token("ws"); // как у настоящей поверхности: сокет показан один раз и всякий раз новый
          st.standings.set(sid, a.name ?? "(unnamed)");
          st.places.set(`${a.karta}:${a.name}`, {
            karta: String(a.karta),
            name: a.name ?? "",
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
          const had = st.places.delete(`${a.karta}:${name}`);
          for (const sock of st.ws) {
            sock.write(wsFrame(0x8, Buffer.from([4001 >> 8, 4001 & 0xff])));
            setTimeout(() => sock.end(), 100).unref();
          }
          for (const [sid2, bound] of st.standings) if (bound === name) st.standings.delete(sid2);
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
          const bound = st.standings.get(sid);
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
                      text: "Отказано (409, session_not_registered): эта сессия не зарегистрирована ни за каким стоянием",
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
          const mine = st.webhooks.filter((w) => String(w.karta) === String(a.node_id));
          const lines = [`Вебхуки для #${a.node_id} (${mine.length}):`];
          for (const w of mine) {
            const wakes = [...st.places.values()].find((p) => p.incoming === w.url);
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
          st.counts.webhooks_added++;
          const id = 100 + st.webhooks.length;
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
        const bound = st.standings.get(sid);
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
    st.ws.add(socket);
    socket.on("close", () => st.ws.delete(socket));
    socket.on("error", () => st.ws.delete(socket));
    socket.write(wsFrame(0x1, JSON.stringify({ type: "hello", pending: 0, ping: 30 })));
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
