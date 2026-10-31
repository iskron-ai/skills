// Pure evidence helpers for the pi runner (scripts/stand-run-pi.mjs); no model, credentials or
// graph access on import. The pi session format is JSONL (pi docs, session-format.md): a leading
// `{"type":"session","version":3,"id","cwd"}` header, then `{"type":"message"}` entries whose
// `message` is an AgentMessage — user content is a string or text blocks, assistant content is
// (TextContent | ThinkingContent | ToolCall) blocks with `provider`/`model`/`usage` on the
// message, and tool results are separate `role:"toolResult"` messages paired by `toolCallId`.
// Observed on pi 1.2.0 by running it (case №2428): bash's parameters are
// {"command": string, "timeout"?: number}.
import { existsSync, readFileSync } from "node:fs";

/** The launch line's shape — js/shared/launch.ts (LAUNCH_LINE) as the pi runner reads it back;
 * a delivery may change its form, so this mirror lives next to its only consumer. */
const LINE = /^[ \t]*start\s+(\S+)\s+(\S+)\s+(?:(?:дело|case)\s+)?[№#]\s?(\d+)(?:[ \t]+(?:от|from)[ \t]+(@\S+))?(?=\s|$)/im;

/** The launch line of a prompt's first line; none — null. Groups: realm, karta, case no, launcher's seat. */
export function parseLaunchLine(text) {
  const m = LINE.exec(String(text ?? ""));
  return m ? { realm: m[1], karta: m[2], no: m[3], of: m[4] ?? null } : null;
}

/**
 * The isolated home's auth entries from the machine's (case №2394): api keys as they lie; an
 * OAuth entry WITHOUT its refresh token — the isolated home runs on the live access token alone
 * and can never rotate the person's login. Throws when a needed provider has no entry, or when an
 * OAuth entry's access token expires within the hour — the person must refresh the real login
 * first (the run fails fast rather than failing deep inside a probe, exit 2).
 */
export function isolatedPiAuth({ machineAuth, needed, now = Date.now() }) {
  const isolated = {};
  for (const prov of [...new Set(needed)]) {
    const entry = machineAuth?.[prov];
    if (!entry || !["api_key", "oauth"].includes(entry.type))
      throw new Error(`no key or OAuth login of ${prov} in this machine's pi auth (${Object.keys(machineAuth ?? {}).join(", ")})`);
    if (entry.type === "oauth") {
      if (!(Number(entry.expires) > now + 3600_000))
        throw new Error(
          `${prov}: the OAuth access token expires within the hour (${new Date(Number(entry.expires)).toISOString()}) — refresh the person's real pi login on the machine first, then rerun; the isolated home never rotates the login itself`,
        );
      isolated[prov] = { type: entry.type, access: entry.access, expires: entry.expires, accountId: entry.accountId };
    } else isolated[prov] = entry;
  }
  return isolated;
}

/** A whole session file parsed; { path, header, entries } or null when unreadable. */
export function readPiSession(path) {
  if (!existsSync(path)) return null;
  let entries;
  try {
    entries = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  } catch {
    return null;
  }
  const header = entries.find((e) => e.type === "session") ?? null;
  return { path, header, entries, file: path.split("/").pop() };
}

/** The session's message entries in order. */
export const sessionMessages = (session) => (session?.entries ?? []).filter((e) => e.type === "message").map((e) => e.message);

const textOf = (content) =>
  typeof content === "string" ? content : (content ?? []).filter((b) => b?.type === "text").map((b) => b.text).join("\n");

/** The first user message's text — the prompt as it reached the model (after any harness transform). */
export function firstUserText(session) {
  const u = sessionMessages(session).find((m) => m?.role === "user");
  return u ? textOf(u.content) : "";
}

/** The assistant tool calls paired with their results: { name, args, at, toolCallId, result, resultAt, isError }. */
export function piToolCalls(session) {
  const out = [];
  const results = new Map(sessionMessages(session).filter((m) => m?.role === "toolResult").map((m) => [m.toolCallId, m]));
  for (const m of sessionMessages(session)) {
    if (m?.role !== "assistant") continue;
    for (const b of m.content ?? []) {
      if (b?.type !== "toolCall") continue;
      const r = results.get(b.id);
      out.push({
        name: String(b.name),
        args: b.arguments ?? {},
        at: Number(m.timestamp ?? 0),
        toolCallId: b.id,
        result: r ? textOf(r.content) : null,
        resultAt: r ? Number(r.timestamp ?? 0) : null,
        isError: Boolean(r?.isError),
      });
    }
  }
  return out.sort((x, y) => x.at - y.at);
}

/** The distinct models that answered in the session, with usage totals (pi names the model per message). */
export function piActualModels(session) {
  const byModel = new Map();
  for (const m of sessionMessages(session)) {
    if (m?.role !== "assistant" || !m.model) continue;
    const key = `${m.provider ?? "?"}/${m.model}`;
    const u = byModel.get(key) ?? { messages: 0, input: 0, output: 0, cacheRead: 0, cost: 0 };
    u.messages++;
    u.input += m.usage?.input ?? 0;
    u.output += m.usage?.output ?? 0;
    u.cacheRead += m.usage?.cacheRead ?? 0;
    u.cost += m.usage?.cost?.total ?? 0;
    byModel.set(key, u);
  }
  return [...byModel.entries()].map(([model, u]) => ({ model, ...u }));
}

/** The model's answer to the last turn: assistant text after the last user message. */
export function piLastAnswer(session) {
  const msgs = sessionMessages(session);
  const lastUser = msgs.map((m) => m?.role).lastIndexOf("user");
  return msgs
    .slice(lastUser + 1)
    .filter((m) => m?.role === "assistant")
    .flatMap((m) => (m.content ?? []).filter((b) => b?.type === "text").map((b) => b.text))
    .join("\n");
}

/** A bash tool call that launches a child pi process with the launch line — the pi form of a
 * subagent launch (case №2394 [36]): the command names pi with -p/--print and carries the launch
 * line's shape somewhere in its text. The child's own session is the stronger, verbatim
 * evidence; this is the root's side of the observation. */
export function piLaunchCommands(session) {
  return piToolCalls(session)
    .filter((c) => c.name === "bash" && typeof c.args?.command === "string")
    .map((c) => ({ ...c, command: c.args.command }))
    .filter(({ command }) => /\bpi\b/.test(command) && /(^|\s)(--print|-p)(\s|$|=)/.test(command))
    .map((c) => ({
      ...c,
      launch: parseLaunchLine(c.command.replace(/['"`]/g, "\n")),
      // The inline shape: the launch line's form somewhere in the command text — «от» has no
      // ASCII word boundary before it, so the tail is matched without one (the prompt-form regex
      // above needs no such check — it anchors the whole line).
      inline: /\bstart\s+\S+\s+\S+\s+(?:(?:дело|case)\s+)?[№#]\s?\d+/.test(c.command) && /(?:от|from)\s+@\S+/.test(c.command),
    }));
}

/** The session as text for the report: the person's words, the model's text, every tool call. */
export function piJournal(session) {
  const out = [];
  for (const e of session?.entries ?? []) {
    const at = e.timestamp ?? "";
    if (e.type !== "message") continue;
    const m = e.message;
    if (m?.role === "user") out.push(`[${at}] USER: ${textOf(m.content)}`);
    else if (m?.role === "assistant")
      for (const b of m.content ?? []) {
        if (b?.type === "text") out.push(`[${at}] TEXT: ${b.text}`);
        else if (b?.type === "toolCall")
          out.push(`[${at}] TOOL ${b.name}\n  input: ${JSON.stringify(b.arguments)}\n  provider/model: ${m.provider ?? "?"}/${m.model ?? "?"}`);
      }
    else if (m?.role === "toolResult")
      out.push(`[${at}] RESULT ${m.toolName} isError=${Boolean(m.isError)}\n  output: ${textOf(m.content).slice(0, 2000)}`);
  }
  return out.join("\n");
}

// The graph-call shapes the verdicts read — the same call families as the OpenCode runner's
// (scripts/stand-run-recall.mjs), judged on pi sessions instead of tee attribution.
export const isSearchCall = (c) => ["iskron_search", "iskron_semantic_search"].includes(c.name);
export const looksCall = (c, id) =>
  !c.isError && ((c.name === "iskron_look" && String(c.args.node_id ?? "").replace(/^#/, "").trim() === String(id)) || (c.name === "iskron_orient" && String(c.args.focus ?? "").replace(/^#/, "").trim() === String(id)));
/** A word to someone: a case talk/say/ask/invite or a channel send — by either the root or a child. */
export const addressingCall = (c) => (c.name === "iskron_case" && ["talk", "say", "ask", "invite"].includes(c.args?.action)) || (c.name === "iskron_channel" && c.args?.action === "send");
/** Whether the word went to the person's role alone; otherwise a brother (another seat or role). */
export function toBrotherCall(c, human) {
  if (!addressingCall(c)) return false;
  const to = ["with", "to", "karta", "standing"].map((k) => c.args[k]).filter(Boolean).map((v) => String(v).replace(/^#/, "").trim());
  return !(to.length && to.every((x) => x === String(human)));
}

/**
 * The f (and h) observations of a pi run — mechanical rejection only, semantic acceptance stays
 * with the human (the review note says so). `root` and `children` are labelled sessions:
 * { session, role } — the runner knows which session is the root's (it passed the prompt) and
 * which are children (their first user text starts with the launch line). `calls` is the run's
 * tee tools/call journal (scripts/stand-recall-scene.mjs, teeCalls) — kept for the report and
 * for anything the sessions do not carry (service moves of the extension, e.g. the launch line's
 * stand/join, which never appear in a session's tool calls).
 */
export function piEvidence({ key, root, children, calls = [], scene, fact, fixedBrief, briefText = "" }) {
  const node = (v) => String(v ?? "").replace(/^#/, "").trim();
  const errors = [];
  const rootCalls = piToolCalls(root.session);
  const childCalls = children.flatMap(({ session }) => piToolCalls(session));
  const launches = piLaunchCommands(root.session);
  const by = (c) => c;
  const created = [...rootCalls, ...childCalls]
    .filter((c) => /^iskron_add_/.test(c.name))
    .map((c) => ({ by: c, tool: c.name, args: c.args ?? {}, id: (c.result ?? "").match(/\(#(\d+)[,)]/)?.[1] ?? null, isError: c.isError }))
    .filter((c) => !c.isError);
  const batches = [...rootCalls, ...childCalls].filter((c) => c.name === "iskron_batch" && !c.isError);
  const ownReads = created.filter((c) => c.id && rootCalls.some((r) => !r.isError && r.name === "iskron_look" && node(r.args.node_id) === c.id));
  let foreignMutations = [];
  if (scene) {
    const foreignIDs = [scene.foreign, scene.steward, fact].map(String);
    const all = [...rootCalls, ...childCalls];
    foreignMutations = all.filter((c) => /^(iskron_update|iskron_delete_node|iskron_arrow)$/.test(c.name) && [c.args.node_id, c.args.source, c.args.target].some((id) => foreignIDs.includes(node(id))));
    foreignMutations.push(...all.filter((c) => /^iskron_add_/.test(c.name) && (c.args.arrows ?? []).some((a) => foreignIDs.includes(node(a.target)) && ["contains", "context", "steward"].includes(a.arrow_type))));
    if (foreignMutations.length) errors.push("foreign contour mutation");
    if (created.some((c) => c.tool === "iskron_add_kriya" && (c.args.arrows ?? []).some((a) => a.arrow_type === "actor" && node(a.target) === scene.human))) errors.push("owner encoded as actor");
  }
  // What the children actually received: their first prompts verbatim (the extension's word
  // included — the word is placed after the launch line, the brief follows it).
  const received = children.map(({ session, launch }) => ({
    sessionID: session.header?.id ?? session.file,
    role: launch?.karta ?? "?",
    case: launch?.no ?? null,
    of: launch?.of ?? null,
    firstPrompt: firstUserText(session),
    models: piActualModels(session),
    toolCalls: piToolCalls(session).length,
  }));
  if (key === "f") {
    if (!children.length) errors.push("no child process with the launch line observed");
    // The seven source steps — verbatim in what the ingester received (OpenCode checks the
    // task tool's input; pi checks the child's first prompt — the same brief, another carrier).
    const steps = (briefText || "").split("\n").filter((line) => /^[1-7]\. /.test(line));
    if (steps.length && !received.some((c) => steps.every((s) => c.firstPrompt.includes(s))))
      errors.push("no child received all seven source steps");
    // The fixed brief verbatim: every piece between its placeholders (case №2394 [19]).
    if (fixedBrief) {
      const pieces = fixedBrief.split("\n").flatMap((line) => line.split(/\{[A-Z]+\}/)).map((s) => s.trim()).filter((s) => s.length > 3);
      const best = received.map((c) => ({ c, missing: pieces.filter((s) => !c.firstPrompt.includes(s)) })).sort((x, y) => x.missing.length - y.missing.length)[0];
      if (best && best.missing.length) errors.push(`fixed brief not verbatim: ${best.missing.length} pieces missing to ${best.c.sessionID}`);
    }
    if (children.length && !children.some(({ session }) => piToolCalls(session).length)) errors.push("no observed child tool calls");
  }
  return {
    errors,
    launches,
    received,
    created: created.map((c) => ({ tool: c.tool, id: c.id, args: c.args })),
    batches,
    ownReads: ownReads.map((c) => c.id),
    foreignMutations,
    review:
      "Inspect the root's sketch-before-launch (or its fixed-brief fidelity), the child's first prompt (the actual brief the ingester received), all seven steps/three actors for f, produced nodes and arrows, root reads/comparison and absence of foreign writes (including batches). No automated semantic PASS.",
  };
}
