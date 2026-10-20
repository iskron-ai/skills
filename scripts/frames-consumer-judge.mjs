// The verdicts of frames-consumer-run.mjs: what the api meant for a seat, judged against what
// the bridge and its watchdog showed it (case №1249; delivery rule — graph @nks/nks-dev, #6574).
// Pure functions: the run observes, this file decides — the probe in js/tests holds them.
//
// The api's intent is read from the frame's own address fields, never from the bridge's rule:
// a seat named by id (else by its @-address) in fields.to.standing, fields.to, fields.standing
// of an invite, addressee (string or seat), word.line.fields.to, word.addressee; a reply word
// names in_reply_to_from when nothing else is named; a body inherits its said's seats. A
// question kind (ask, answer, ack) naming no seat is nobody's (#6867); anything else naming
// no seat, a frame outside a case and a stale one are not judged.

const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const str = (v) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const kindOf = (f) => str(f.event_kind).replace(/^room\./, "") || str(obj(f.line).kind);
const ASK_KINDS = new Set(["ask", "answer", "ack"]);

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
  const reply = kind === "said" && seat(f.in_reply_to_from);
  return reply ? [reply] : [];
}

/** mine | theirs | nobody | null (not judged) for the seat {standing_id, standing}. */
export function intentFor(f, me, refs = []) {
  if (!str(obj(f.room).id) && !str(obj(f.room).seq)) return null; // not a case record: the rule is not about it
  const named = namedSeats(f, refs);
  if (!named.length) return ASK_KINDS.has(kindOf(f)) ? "nobody" : null;
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
    recordLine: lines.some((l) => l.includes(`[${entry}]`) && !/записей \d+, тебе|→/.test(l)),
  };
}

/** One record's verdict: pass | fail | rejected | unjudged, with the reasons of a fail. */
export function judge(intent, obs) {
  if (!obs.delivered && obs.repeat) return { verdict: "unjudged", why: ["a repeat of a delivered id"] };
  if (!obs.delivered) return { verdict: "rejected", why: ["the bridge handed the frame to no client"] };
  if (obs.stale) return { verdict: "unjudged", why: ["stale: the stale batch, not the address rule"] };
  if (!intent) return { verdict: "unjudged", why: [] };
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

/** A branch's outcome over its records: fail > rejected > pass > not-covered. */
export function branchOutcome(records) {
  const v = new Set(records.map((r) => r.verdict));
  if (v.has("fail")) return "fail";
  if (v.has("rejected")) return "rejected";
  return v.has("pass") ? "pass" : "not-covered";
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
