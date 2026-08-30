// A local stand-in for an OAuth-protected streamable-HTTP MCP server.
//
// It exists so the bridge's whole authorization leg — discovery, dynamic client
// registration, PKCE, the loopback redirect, token exchange, refresh rotation —
// can be watched end to end without a browser and without the product instance.
// The one leg it cannot stand in for is a human deciding to consent; here the
// test plays that part by fetching the authorize URL itself.

import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";

const b64url = (b) => Buffer.from(b).toString("base64url");
const sha256 = (s) => createHash("sha256").update(s).digest();
const token = (p) => `${p}-${b64url(randomBytes(9))}`;
// Tokens that carry their own hours, the way a real server's JWTs do.
const jwt = (claims) => [b64url('{"alg":"none"}'), b64url(JSON.stringify(claims)), "sig"].join(".");
const secs = (ms) => Math.floor(ms / 1000); // a JWT keeps whole seconds, so the test does too

// A refresh token the server holds back until the access token is nearly spent:
// carried as a JWT `nbf`, refused in the words of a dead grant if used early.
function mintRefresh(st) {
  if (!st.refreshNotBeforeMs) { st.refreshValidFrom = 0; return token("refresh"); }
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

export async function startFakeNks(opts = {}) {
  const st = {
    accessTtl: opts.accessTtl ?? 3600,
    clients: new Map(),
    codes: new Map(),
    access: null,
    refresh: null,
    sessions: new Set(),
    dead: new Set(),
    // faults the test switches on through /control
    refreshStatus: null,   // e.g. 503 (transient) or 400 (definitive)
    refreshError: null,
    mcpStatus: null,       // force an HTTP status on /mcp
    mcpHangMs: 0,          // hold /mcp open past the caller's deadline: the request left, the answer never came
    refreshDelayMs: opts.refreshDelayMs ?? 0, // widen the window several bridges race in
    codeDelayMs: opts.codeDelayMs ?? 0,       // hold the code exchange open, as a slow server does
    refreshNotBeforeMs: opts.refreshNotBeforeMs ?? 0, // hold the refresh token back this long
    accessExpSkewSec: opts.accessExpSkewSec ?? 0,     // make the access token's own exp disagree with expires_in
    padBytes: opts.padBytes ?? 0,                     // make answers bigger than one pipe buffer
    // The server's clock runs this far ahead of the machine's (a customer's
    // clock running behind is the same fact seen from the other side). Every
    // stamped hour and every judgement the fake makes uses this clock, and the
    // Date header on each answer says so out loud, as a real server's does.
    clockSkewMs: opts.clockSkewMs ?? 0,
    tokenPath: opts.tokenPath ?? "/token",            // where the token endpoint lives today
    // The posture RFC 9700 recommends for rotating grants: a refresh token
    // presented after it was rotated away is treated as a stolen one, and the
    // whole family dies with it. Off by default — a test asks for it when the
    // point IS what replay costs.
    reuseDetection: opts.reuseDetection ?? false,
    counts: { register: 0, authorize: 0, code_exchange: 0, refresh: 0, stale_refresh: 0, early_refresh: 0, mcp: 0,
              register_standing: 0, attributed_send: 0, unattributed: 0 },
    standings: new Map(), // сессия MCP → имя стояния; убивается вместе с сессией
    // The resource indicator each leg carried. A real server turns this into
    // the token's audience, so it is the only place a test can see what the
    // bridge actually asked to be issued for.
    resources: { authorize: null, code_exchange: null, refresh: null },
  };

  const body = (req) => new Promise((res, rej) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => res(b)); req.on("error", rej);
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

    if (p === "/control") {
      const patch = JSON.parse((await body(req)) || "{}");
      if (patch.kill_session) { for (const s of st.sessions) st.dead.add(s); st.sessions.clear(); }
      for (const k of ["refreshStatus", "refreshError", "mcpStatus", "mcpHangMs", "accessTtl", "refreshDelayMs", "reuseDetection", "tokenPath"]) {
        if (k in patch) st[k] = patch[k];
      }
      if (patch.revoke_access) st.access = null;
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
        if (!c) return json(res, 400, { error: "invalid_grant", error_description: "unknown code" });
        st.codes.delete(f.get("code"));
        if (b64url(sha256(f.get("code_verifier") || "")) !== c.challenge) {
          return json(res, 400, { error: "invalid_grant", error_description: "PKCE mismatch" });
        }
        if (f.get("redirect_uri") !== c.redirect_uri) {
          return json(res, 400, { error: "invalid_grant", error_description: "redirect_uri mismatch" });
        }
        st.access = mintAccess(st); st.refresh = mintRefresh(st);
        return json(res, 200, { access_token: st.access, refresh_token: st.refresh, expires_in: st.accessTtl, token_type: "Bearer" });
      }
      if (f.get("grant_type") === "refresh_token") {
        st.counts.refresh++;
        st.resources.refresh = f.get("resource");
        if (st.refreshValidFrom && st.snow() < st.refreshValidFrom) {
          st.counts.early_refresh++;
          return json(res, 400, { error: "invalid_grant", error_description: "token not yet valid" });
        }
        if (st.refreshStatus) {
          return json(res, st.refreshStatus, { error: st.refreshError || "server_error" });
        }
        if (f.get("refresh_token") !== st.refresh) {
          st.counts.stale_refresh++;
          if (st.reuseDetection) { st.access = null; st.refresh = null; }
          return json(res, 400, { error: "invalid_grant", error_description: "stale refresh token" });
        }
        if (st.refreshDelayMs) await new Promise((r) => setTimeout(r, st.refreshDelayMs));
        if (f.get("refresh_token") !== st.refresh) { // rotated while we were slow
          st.counts.stale_refresh++;
          if (st.reuseDetection) { st.access = null; st.refresh = null; }
          return json(res, 400, { error: "invalid_grant", error_description: "stale refresh token" });
        }
        st.access = mintAccess(st); st.refresh = mintRefresh(st); // rotation
        return json(res, 200, { access_token: st.access, refresh_token: st.refresh, expires_in: st.accessTtl, token_type: "Bearer" });
      }
      return json(res, 400, { error: "unsupported_grant_type" });
    }

    if (p === "/mcp" && req.method === "POST") {
      st.counts.mcp++;
      if (st.mcpHangMs) await new Promise((r) => setTimeout(r, st.mcpHangMs));
      if (st.mcpStatus) { res.writeHead(st.mcpStatus); return res.end("forced fault"); }
      const bearer = (req.headers.authorization || "").replace(/^Bearer /, "");
      if (!st.access || bearer !== st.access) {
        return json(res, 401, { error: "unauthorized" }, {
          "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
        });
      }
      const sid = req.headers["mcp-session-id"];
      const msg = JSON.parse(await body(req));
      if (sid && st.dead.has(sid)) { res.writeHead(404); return res.end("session expired"); }

      if (msg.method === "initialize") {
        const fresh = token("session");
        st.sessions.add(fresh);
        return json(res, 200, {
          jsonrpc: "2.0", id: msg.id,
          result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake-nks", version: "0" } },
        }, { "mcp-session-id": fresh });
      }
      if (msg.id === undefined || msg.id === null) { res.writeHead(202); return res.end(); }
      if (msg.method === "tools/list") {
        return json(res, 200, { jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "nks_orient" }] } });
      }
      // Стояние делателя, смоделированное так, как его держит настоящая
      // поверхность: коррелятор писателя — идентификатор сессии MCP. Новая
      // сессия — другой писатель, и её память о регистрации собрана вместе со
      // старой. Ровно поэтому перерегистрация — забота моста: он один видит
      // смену id и один помнит выведенное имя.
      if (msg.method === "tools/call" && msg.params?.name === "iskron_channel") {
        const a = msg.params.arguments ?? {};
        if (a.action === "register") {
          st.counts.register_standing++;
          st.standings.set(sid, a.name ?? "(unnamed)");
          return json(res, 200, { jsonrpc: "2.0", id: msg.id,
            result: { content: [{ type: "text", text: `зарегистрировано: ${a.name}` }] } });
        }
        if (a.action === "send") {
          const bound = st.standings.get(sid);
          if (!bound) {
            st.counts.unattributed++;
            return json(res, 200, { jsonrpc: "2.0", id: msg.id, result: { isError: true,
              content: [{ type: "text", text: "Отказано (409): эта сессия не зарегистрирована ни за каким стоянием" }] } });
          }
          st.counts.attributed_send++;
          return json(res, 200, { jsonrpc: "2.0", id: msg.id,
            result: { content: [{ type: "text", text: `принято стоянием ${bound}` }] } });
        }
      }
      return json(res, 200, { jsonrpc: "2.0", id: msg.id,
        result: { ok: true, method: msg.method, ...(st.padBytes ? { pad: "x".repeat(st.padBytes) } : {}) } });
    }

    res.writeHead(404); res.end();
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    mcpUrl: `${base}/mcp`,
    state: st,
    control: (patch) => fetch(`${base}/control`, { method: "POST", body: JSON.stringify(patch) }).then((r) => r.json()),
    stop: () => new Promise((r) => server.close(r)),
  };
}
