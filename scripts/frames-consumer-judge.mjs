// The verdicts of frames-consumer-run.mjs: what the api meant for a seat, judged against what
// the bridge and its watchdog showed it (case №1249; delivery rule — graph @nks/nks-dev, #6574).
// Pure functions: the run observes, this file decides — the probe in js/tests holds them.
//
// The api's intent is read from the frame's own address fields, never from the bridge's rule:
// a seat named by id (else by its @-address) in fields.to.standing, fields.to, fields.standing
// of an invite, addressee (string or seat), word.line.fields.to, word.addressee; a body
// inherits its said's seats; a said or progress replying (in_reply_to) without an explicit to
// names the author of the answered record, in_reply_to_from (#6574, #6867 — as the bridge
// does). A question kind (ask, answer, ack) naming no seat is nobody's (#6867), and so is a
// reply naming no author; anything else naming no seat, a frame outside a case and a stale one
// are not judged. A person's seat is outside the bridge (its window or bot delivers it; the
// person-only exception of #6908 v4 is theirs): judged neither pass nor fail.

const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const str = (v) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const kindOf = (f) => str(f.event_kind).replace(/^room\./, "") || str(obj(f.line).kind);
const ASK_KINDS = new Set(["ask", "answer", "ack"]);
const REPLY_KINDS = new Set(["said", "progress"]);

/** Seats a frame names, each {id, addr}; refs — the file's frames, for a body's said. */
export function namedSeats(f, refs = []) {
  const line = obj(f.line);
  const fields = obj(line.fields);
  const kind = kindOf(f);
  const seat = (v) =>
    typeof v === "string"
      ? v.startsWith("@") && { id: "", addr: v }
      : (str(obj(v).id) || str(obj(v).standing)) && { id: str(obj(v).id), addr: str(obj(v).standing) };
  const named = [
    obj(fields.to).standing,
    fields.to,
    kind === "invite" || kind === "withdraw" ? fields.standing : null,
    f.addressee,
    obj(obj(obj(f.word).line).fields).to,
    obj(f.word).addressee,
  ]
    .map(seat)
    .filter(Boolean);
  if (named.length) return named;
  if (kind === "body") {
    const of = str(line.refers_to) || str(f.in_reply_to);
    const said = refs.find((r) => r !== f && kindOf(r) === "said" && str(r.entry_id) === of);
    return said ? namedSeats(said, refs) : [];
  }
  // A reply without an explicit to goes to the author of the answered record (#6574, #6867):
  // a said or progress names in_reply_to_from; answer and ack only by fields.to (above).
  const author = REPLY_KINDS.has(kind) && f.in_reply_to != null && seat(f.in_reply_to_from);
  return author ? [author] : [];
}

/** mine | theirs | nobody | null (not judged) for the seat {standing_id, standing}. */
export function intentFor(f, me, refs = []) {
  if (!str(obj(f.room).id) && !str(obj(f.room).seq)) return null; // not a case record: the rule is not about it
  const named = namedSeats(f, refs);
  const reply = REPLY_KINDS.has(kindOf(f)) && f.in_reply_to != null;
  if (!named.length) return ASK_KINDS.has(kindOf(f)) || reply ? "nobody" : null;
  const byId = named.find((s) => s.id);
  if (byId && me.standing_id) return byId.id === me.standing_id ? "mine" : "theirs";
  const byAddr = named.find((s) => s.addr);
  return byAddr && byAddr.addr === me.standing ? "mine" : "theirs";
}

/** The frame's own words: what must not reach another seat and must reach the addressed one. */
export function textsOf(f) {
  const line = obj(f.line);
  const all = [line.done, f.body, obj(obj(f.word).line).done].map(str).map((s) => s.trim());
  return [...new Set(all.filter((s) => s.length >= 3))];
}

/** What a record segment of watchdog output says: counts, «тебе», closing lines, record lines. */
export function readSegment(text, entry) {
  const counts = [...text.matchAll(/записей (\d+), тебе (\d+)/g)];
  const lines = text.split("\n").filter(Boolean);
  return {
    count: counts.length ? counts.reduce((a, m) => a + Number(m[1]), 0) : null,
    yours: counts.length ? counts.reduce((a, m) => a + Number(m[2]), 0) : null,
    closing: [...text.matchAll(/вопрос \[\d+\] к тебе (?:закрыт|переадресован)[^;\n]*/g)].map((m) => m[0]),
    // A line of the record itself — «№N «зачин» [entry] …» — or an arrow line naming it
    // («автор → адресат: [entry]»): either shows a record without text to the seat.
    recordLine: lines.some((l) => l.includes(`» [${entry}]`) || (l.includes("→") && l.includes(`[${entry}]`))),
  };
}

/** Whether the frame carries some address the intent did not read: addressee, fields.to, word.addressee. */
export function addressHint(f) {
  const fields = obj(obj(f.line).fields);
  return f.addressee != null || Object.keys(obj(fields.to)).length > 0 || obj(f.word).addressee != null;
}

/** One record's verdict: pass | fail | rejected | unjudged, with the reasons of a fail. */
export function judge(intent, obs) {
  if (obs.outside) return { verdict: "outside-bridge", why: ["a person's seat: its window or bot delivers it"] };
  if (!obs.delivered && obs.repeat) return { verdict: "unjudged", why: ["a repeat of a delivered id"] };
  if (!obs.delivered) return { verdict: "rejected", why: ["the bridge handed the frame to no client"] };
  if (obs.stale) return { verdict: "unjudged", why: ["stale: the stale batch, not the address rule"] };
  if (!intent && obs.hint) return { verdict: "unparsed", why: ["an address the judge does not read"] };
  if (!intent) return { verdict: "unjudged", why: [] };
  if (intent === "mine" && obs.withheld)
    return { verdict: "unjudged", why: ["the api withheld the text from the seat it names"] };
  const why = [];
  if (intent === "mine") {
    if (obs.texts.length ? !obs.shown.length : !obs.recordLine) why.push("no text for the addressed seat");
    if (obs.addressed === false) why.push("addressed: false on the addressed seat");
    if (obs.yours === 0) why.push("тебе 0 on the addressed seat");
  } else {
    if (obs.shown.length) why.push(`text reached another seat: ${obs.shown.join(" | ")}`);
    else if (obs.recordLine) why.push("a record line on another seat");
    if (obs.addressed === true) why.push("addressed: true on another seat");
    if (obs.yours > 0) why.push(`тебе ${obs.yours} on another seat`);
  }
  return { verdict: why.length ? "fail" : "pass", why };
}

/**
 * A branch's outcome over its records: fail > rejected > unparsed (an address the judge did
 * not read — not a pass) > pass > unjudged > outside-bridge (only persons' seats) > not-covered
 * (no records). Records of persons' seats decide nothing.
 */
export function branchOutcome(records) {
  const v = new Set(records.map((r) => r.verdict));
  if (v.has("fail")) return "fail";
  if (v.has("rejected")) return "rejected";
  if (v.has("unparsed")) return "unparsed";
  if (v.has("pass")) return "pass";
  if (records.some((r) => r.verdict !== "outside-bridge")) return "unjudged";
  return records.length ? "outside-bridge" : "not-covered";
}

/** The table: one row per record of every seat, branch by branch, and the branch outcome. */
export function table(branches) {
  const rows = [["branch", "seat", "entry", "kind", "intent", "записей/тебе", "addressed", "text", "closing", "verdict"]];
  for (const b of branches) {
    for (const r of b.records)
      rows.push([
        b.branch,
        r.seat,
        r.entry,
        r.kind,
        r.intent ?? "—",
        r.count === null ? "—" : `${r.count}/${r.yours}`,
        r.addressed === undefined ? "—" : String(r.addressed),
        r.shown.length ? "shown" : r.texts.length ? "hidden" : "—",
        r.closing.join("; ") || "—",
        r.verdict + (r.why.length ? `: ${r.why.join("; ")}` : ""),
      ]);
    rows.push([b.branch, "", "", "", "", "", "", "", "", `BRANCH ${b.outcome.toUpperCase()}`]);
  }
  const w = rows[0].map((_, i) => Math.min(40, Math.max(...rows.map((r) => String(r[i]).length))));
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : String(c).padEnd(w[i]))).join("  ")).join("\n");
}
