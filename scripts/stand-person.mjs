// The person's moves of the live bridge run, straight at the api (graph @nks/nks-dev, node #7636):
// the MCP drops its as_person, the api keeps it. Taking a seat off — DELETE /channels/{channel_id}
// (node #2281); a word to a seat without a seat of one's own — POST /channels/send with
// as_person: true. Who the person is: --person — a test identity the LOCAL api trusts by
// X-Forwarded-User; without it — the run's own credential, a PAT is its person.
//
// Answers in the MCP call's shape the drivers check: { error, text }.

/** The seat's full address `@handle:name` from the board's text: the api names a seat in full. */
export function seatAddress(boardText, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return boardText.match(new RegExp(`@[^\\s:]+:${esc}(?=[\\s—]|$)`, "m"))?.[0] ?? name;
}

export function personApi({ api, person, token }) {
  if (!api) throw new Error("the person's moves need --api: the MCP no longer acts as the person");
  async function call(method, path, realm, body) {
    const h = { "Content-Type": "application/json", "X-NKS-Realm": realm };
    if (person) Object.assign(h, { "X-Forwarded-User": person, "X-Forwarded-User-Pref-Username": person });
    else h.Authorization = `Bearer ${token}`;
    const r = await fetch(api.replace(/\/$/, "") + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const raw = await r.text();
    return { error: !r.ok, text: `${method} ${path} → ${r.status}${raw ? ` ${raw.slice(0, 300)}` : ""}` };
  }
  return {
    revoke: (realm, channel) => call("DELETE", `/channels/${channel}`, realm),
    send: (realm, karta, standing, text) =>
      call("POST", "/channels/send", realm, { karta: String(karta).replace(/^#/, ""), standing, text, as_person: true }),
  };
}
