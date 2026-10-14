// Stop orders on the fake NKS, as api 0.122.0 serves them (graph @nks/nks-dev, nodes #7509,
// #7510; word of #48 in case №669): the stop frame on the seat's channel, GET /api/me/orders,
// POST /api/me/orders/{id}/ack. An outcome closes the order and ends the seat — the founder
// seat ends its channel whole, its seats beside too, and closes the channel's sockets once with
// 4001 revoked:self; a seat beside goes alone by a standing_ended frame. /control: stop_order {id, standing_id, frame?, by?, reason_code?} puts
// an order (frame: false — readable only), stop_orders: [...] many, orders_ack_drop: n — the next n answers lose their
// connection without an answer, orders_ack_delay: {state: ms} — answers of that state are taken
// so much later. The read pages by since and limit (≤200) as the api does: next_since — the
// last seq given.

const OPEN = new Set(["issued", "accepted"]);

export const ordersState = () => ({
  list: new Map(),
  seq: 0,
  acks: [],
  reads: 0,
  queries: [],
  ackDrop: 0,
  ackDelay: {},
  human: [],
  routeMissing: false,
});

/** The channel holding the seat with this id, and the seat's graph in it. */
function seatOf(st, id) {
  for (const [chan, c] of st.channels)
    for (const [realm, p] of c.places) if (p.standing_id === id) return { chan, c, realm };
  return null;
}

const channelSockets = (st, chan) => [...st.ws].filter((s) => !chan || st.wsChans.get(s) === chan);

function endSeat(st, id, wsFrame) {
  const at = seatOf(st, id);
  if (!at) return;
  const socks = channelSockets(st, at.chan);
  // The founder (the channel's first seat) ends the channel whole, its seats beside too (#48 in №669).
  if (at.c.places.size === 1 || at.realm === at.c.places.keys().next().value) {
    st.channels.delete(at.chan);
    const why = Buffer.from("revoked:self");
    for (const s of socks) {
      s.write(wsFrame(0x8, Buffer.concat([Buffer.from([4001 >> 8, 4001 & 0xff]), why])));
      setTimeout(() => s.end(), 100).unref();
    }
    return;
  }
  at.c.places.delete(at.realm);
  const frame = JSON.stringify({ type: "standing_ended", standing_id: id, by: "self" });
  for (const s of socks) s.write(wsFrame(0x1, frame));
}

export function ordersControl(st, patch, wsFrame) {
  if (Number.isInteger(patch.orders_ack_drop)) st.orders.ackDrop = patch.orders_ack_drop;
  if (patch.orders_ack_delay) st.orders.ackDelay = patch.orders_ack_delay;
  if ("orders_route_missing" in patch) st.orders.routeMissing = !!patch.orders_route_missing;
  for (const o of [...(patch.stop_orders ?? []), patch.stop_order]) if (o) putOrder(st, o, wsFrame);
}

function putOrder(st, o, wsFrame) {
  const order = {
    id: o.id,
    seq: ++st.orders.seq,
    kind: "stop",
    standing_id: o.standing_id,
    reason_code: o.reason_code ?? "person_request",
    by: o.by ?? "person",
    state: "issued",
    issued_at: new Date().toISOString(),
  };
  st.orders.list.set(order.id, order);
  if (o.frame === false) return order;
  const frame = JSON.stringify({
    type: "stop",
    order_id: order.id,
    standing_id: order.standing_id,
    reason_code: order.reason_code,
    by: order.by,
    issued_at: order.issued_at,
    ack_window_seconds: 60,
  });
  for (const s of channelSockets(st, seatOf(st, o.standing_id)?.chan))
    if (!st.hung.has(s)) s.write(wsFrame(0x1, frame));
  return order;
}

/**
 * The human's stop of a seat (graph @nks/nks-dev, nodes #7518, #5085): POST /api/standings/{id}/stop
 * puts an order (with its frame), as api 0.122; an older api (/control orders_route_missing: true)
 * answers it 404, and DELETE /api/standings/{id} revokes the seat. Each request lands in
 * st.orders.human: {method, id, realm, body, bearer}.
 */
async function standingsRoute(st, req, res, p, authed, { json, body, wsFrame }) {
  const m = /^\/api\/standings\/([^/]+)(\/stop)?$/.exec(p);
  if (!m) return false;
  const id = decodeURIComponent(m[1]);
  const ask = m[2] ? JSON.parse((await body(req)) || "{}") : null;
  const bearer = (req.headers.authorization || "").replace(/^Bearer /, "");
  st.orders.human.push({
    method: req.method,
    id,
    realm: req.headers["x-nks-realm"],
    body: ask,
    bearer,
  });
  if (!authed) return (json(res, 401, { error: "unauthorized" }), true);
  if (!seatOf(st, id)) return (json(res, 410, { error: "standing ended" }), true);
  if (m[2] && req.method === "POST") {
    if (st.orders.routeMissing) return (json(res, 404, { error: "not found" }), true);
    const order = putOrder(st, { id: `ord-${st.orders.seq + 1}`, standing_id: id }, wsFrame);
    return (json(res, 201, order), true);
  }
  if (!m[2] && req.method === "DELETE") {
    endSeat(st, id, wsFrame);
    res.writeHead(204).end();
    return true;
  }
  return false;
}

/** true — the request was an orders route and is answered. */
export async function ordersRoute(st, req, res, p, { json, body, wsFrame }) {
  const bearer = (req.headers.authorization || "").replace(/^Bearer /, "");
  const authed = (!!st.pat && bearer === st.pat) || (!!st.access && bearer === st.access);
  if (p.startsWith("/api/standings/"))
    return standingsRoute(st, req, res, p, authed, { json, body, wsFrame });
  if (!p.startsWith("/api/me/orders")) return false;
  if (p === "/api/me/orders" && req.method === "GET") {
    st.orders.reads++;
    if (!authed) return (json(res, 401, { error: "unauthorized" }), true);
    const q = new URL(req.url, "http://x").searchParams;
    const since = Number(q.get("since") || 0);
    const limit = Math.min(Number(q.get("limit") || 50), 200);
    st.orders.queries.push({ since, limit });
    const items = [...st.orders.list.values()]
      .filter((o) => o.seq > since && (q.get("open") !== "true" || OPEN.has(o.state)))
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
    json(res, 200, { items, next_since: items.at(-1)?.seq ?? since });
    return true;
  }
  const m = /^\/api\/me\/orders\/([^/]+)\/ack$/.exec(p);
  if (!m || req.method !== "POST") return false;
  const ask = JSON.parse((await body(req)) || "{}");
  // orders_ack_delay {state: ms}: the answer of that state is taken (and logged) so much later.
  const delay = st.orders.ackDelay[ask.state];
  if (delay) await new Promise((r) => setTimeout(r, delay));
  if (st.orders.ackDrop > 0) {
    st.orders.ackDrop--;
    st.orders.acks.push({ id: m[1], state: ask.state, dropped: true });
    req.socket.destroy();
    return true;
  }
  if (!authed) return (json(res, 401, { error: "unauthorized" }), true);
  const order = st.orders.list.get(decodeURIComponent(m[1]));
  // sockets — open channel sockets when the answer came: the bridge still held the seat or not.
  st.orders.acks.push({
    id: m[1],
    state: ask.state,
    reason_code: ask.reason_code,
    sockets: st.ws.size,
  });
  if (!order) return (json(res, 404, { error: "not found" }), true);
  if (!OPEN.has(order.state)) {
    if (ask.state === order.state || ask.state === "accepted")
      return (json(res, 200, { ...order, idempotent_noop: true }), true);
    json(res, 409, {
      errors: [{ code: "order_closed", data: { order_id: order.id, state: order.state } }],
    });
    return true;
  }
  if (ask.state === "accepted" && order.state === "accepted")
    return (json(res, 200, { ...order, idempotent_noop: true }), true);
  order.state = ask.state;
  if (ask.state !== "accepted") endSeat(st, order.standing_id, wsFrame);
  json(res, 200, order);
  return true;
}
