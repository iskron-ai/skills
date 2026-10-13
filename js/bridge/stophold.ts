// A foreign close 4001 on the held socket (graph @nks/nks-dev, nodes #7439, #7440): the owner
// took the seat off. The stop mark goes to disk (stopped.ts), every door and the notification
// client hear the stop word, and the seat is released with its records and binding forgotten,
// as on an own revoke — nothing reconnects: the mark refuses every return. Wired into hold.ts
// at load (session.ts) so the holder does not import the mark's writer back.
import { broadcast, type ChannelEvent, forgetSeat, notify } from "./hold.ts";
import { H, whenStopped } from "./holdstate.ts";
import { markStopped, stopWord } from "./stopped.ts";
import { log } from "./streams.ts";
import { state } from "./transport.ts";

whenStopped((key, code, reason) => {
  const s = state.standing;
  const text = s ? markStopped(s, key, code, reason, H.door?.address) : stopWord("", reason);
  log(text);
  const ev: ChannelEvent = { kind: "stopped", key, code, text, ...(reason ? { reason } : {}) };
  broadcast(ev);
  notify("error", ev);
  forgetSeat(text);
});
