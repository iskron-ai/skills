// Stop orders on the fake NKS, as api 0.122.0 serves them (graph @nks/nks-dev, nodes #7509,
// #7510; word of #48 in case №669): the stop frame on the seat's channel, GET /api/me/orders,
// POST /api/me/orders/{id}/ack. An outcome closes the order and ends the seat — the seat alone
// on its channel closes the channel's sockets 4001 revoked:self, a seat beside goes by a
// standing_ended frame. /control: stop_order {id, standing_id, frame?, by?, reason_code?} puts
// an order (frame: false — readable only), orders_ack_drop: n — the next n answers lose their
// connection without an answer.

const OPEN = new Set(["issued", "accepted"]);

export const ordersState = () => ({ list: new Map(), seq: 0, acks: [], reads: 0, ackDrop: 0 });

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
  if (at.c.places.size === 1) {
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
  const o = patch.stop_order;
  if (!o) return;
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
  if (o.frame === false) return;
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
}

/** true — the request was an orders route and is answered. */
export async function ordersRoute(st, req, res, p, { json, body, wsFrame }) {
  if (!p.startsWith("/api/me/orders")) return false;
  const bearer = (req.headers.authorization || "").replace(/^Bearer /, "");
  const authed = (!!st.pat && bearer === st.pat) || (!!st.access && bearer === st.access);
  if (p === "/api/me/orders" && req.method === "GET") {
    st.orders.reads++;
    if (!authed) return (json(res, 401, { error: "unauthorized" }), true);
    const items = [...st.orders.list.values()].filter((o) => OPEN.has(o.state));
    json(res, 200, { items, next_since: st.orders.seq });
    return true;
  }
  const m = /^\/api\/me\/orders\/([^/]+)\/ack$/.exec(p);
  if (!m || req.method !== "POST") return false;
  const ask = JSON.parse((await body(req)) || "{}");
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
