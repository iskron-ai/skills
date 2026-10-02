// The device side of the fake sign-in server (RFC 8628), plugged into
// fake-nks.mjs when a probe asks for `device: {…}`. Shaped on Rauthy, the
// server behind mcp.iskron.ru, as observed live (graph nks-dev: #6570, #6619):
// the code answer and its fields; a poll of the token endpoint with a code it
// does not know — expired and gone, or never issued — answered 400
// expired_token «invalid `device_code` or request has expired». (Rauthy's 404
// «DeviceAuthCode does not exist» is its verification page's answer to the
// human in the browser, never the bridge's: not played here.)
// Paced like Rauthy: a poll sooner than the interval (100 ms of slack) is
// answered slow_down and counted, so a probe can see a bridge that does not
// keep pace. `client` names a client set up by the operator, as the device
// login's named client is; any other id must be registered first, and an
// unknown one is refused as auth.iskron.ru refuses it, observed live: 404
// invalid_client «`client_id` does not exist». The human on the
// other device is played through /control: { device_approve: <user_code> } or
// { device_deny: <user_code> }.

import { randomBytes } from "node:crypto";

export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export function deviceState(opts) {
  if (!opts) return null;
  return {
    interval: opts.interval ?? 1, // seconds, as the wire says
    expiresIn: opts.expiresIn ?? 300,
    client: opts.client ?? null, // a client the operator set up: known without registration
    asked: [], // { client_id, answer } — every code request as it came
    codes: new Map(), // device_code → { user_code, client_id, expires_at, last_poll, approved, denied }
    issued: [], // user codes in the order they went out
    polls: [], // { at, user_code, answer } — every poll as it came
    tooFast: 0,
    slowDownNext: 0, // /control { device_slow_down: n }: answer the next n polls slow_down
    grants: 0,
  };
}

/** Discovery fields the server adds when it offers the device grant. */
export const deviceMeta = (dev, base) =>
  dev
    ? {
        device_authorization_endpoint: `${base}/device`,
        grant_types_supported: ["authorization_code", "refresh_token", DEVICE_GRANT],
      }
    : {};

export function deviceControl(dev, patch) {
  if (!dev) return;
  const find = (uc) => [...dev.codes.values()].find((c) => c.user_code === uc);
  if (patch.device_approve) find(patch.device_approve).approved = true;
  if (patch.device_deny) find(patch.device_deny).denied = true;
  if (patch.device_slow_down) dev.slowDownNext = patch.device_slow_down;
  // Every code dies now, ahead of the expires_in it went out with: the server's refusal of the code is all that tells.
  if (patch.device_expire) for (const c of dev.codes.values()) c.expires_at = Date.now();
}

/** POST /device — a code and the page to open it on. */
export function deviceAuthorize(dev, st, form, base, json, res) {
  const clientId = form.get("client_id");
  const reg =
    st.clients.get(clientId) ??
    (clientId === dev.client ? { grant_types: [DEVICE_GRANT, "refresh_token"] } : null);
  const refuse = (status, error, said) => {
    dev.asked.push({ client_id: clientId, answer: error });
    return json(res, status, { error, ...(said ? { error_description: said } : {}) });
  };
  if (!reg) return refuse(404, "invalid_client", "`client_id` does not exist");
  if (!(reg.grant_types ?? []).includes(DEVICE_GRANT)) return refuse(403, "unauthorized_client");
  dev.asked.push({ client_id: clientId, answer: "code" });
  const deviceCode = randomBytes(16).toString("hex");
  const userCode = randomBytes(4).toString("hex").toUpperCase();
  dev.codes.set(deviceCode, {
    user_code: userCode,
    client_id: form.get("client_id"),
    expires_at: Date.now() + dev.expiresIn * 1000,
    last_poll: 0,
  });
  dev.issued.push(userCode);
  return json(res, 200, {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${base}/device-page`,
    verification_uri_complete: `${base}/device-page?code=${userCode}`,
    expires_in: dev.expiresIn,
    interval: dev.interval,
  });
}

/** The token endpoint's device_code leg; `grant` mints the tokens, as a code exchange would. */
export function devicePoll(dev, form, grant, json, res) {
  const code = dev.codes.get(form.get("device_code"));
  const answer = (status, body) => {
    dev.polls.push({ at: Date.now(), user_code: code?.user_code, answer: body.error ?? "grant" });
    return json(res, status, body);
  };
  if (!code || Date.now() >= code.expires_at) {
    return answer(400, {
      error: "expired_token",
      error_description: "invalid `device_code` or request has expired",
    });
  }
  if (code.client_id !== form.get("client_id")) return answer(400, { error: "invalid_request" });
  const now = Date.now();
  const early = code.last_poll && now - code.last_poll < dev.interval * 1000 - 100;
  code.last_poll = now;
  if (early) dev.tooFast++;
  if (early || dev.slowDownNext > 0) {
    if (!early) dev.slowDownNext--;
    return answer(400, { error: "slow_down" });
  }
  if (code.denied) return answer(400, { error: "access_denied" });
  if (!code.approved) return answer(400, { error: "authorization_pending" });
  dev.codes.delete(form.get("device_code"));
  dev.grants++;
  return answer(200, grant());
}
