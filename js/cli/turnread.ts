// The last turn of a Claude Code transcript, as the Stop hook reads it (shared/turnend.ts, graph
// @nks/nks-dev, node #9342). A frame comes in as a task notification of the watchdog's task —
// a Monitor or a background shell whose command runs `watchdog`, the task's id taken from its
// result — or as text under the delivery's mark; a prompt of the human's origin, or of none, is
// a human's word, another origin (a peer, another task) is neither.
// The turn runs back from the end to the previous end of the assistant's turn.
import { readFileSync } from "node:fs";

import { LANGS, WATCHDOG } from "../delivery/index.ts";
import { marked, speaks, type TurnSeen } from "../shared/turnend.ts";

interface Block {
  type?: string;
  text?: unknown;
  id?: unknown;
  name?: unknown;
  input?: { command?: unknown };
  tool_use_id?: unknown;
  content?: unknown;
}
interface Entry {
  type?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  isCompactSummary?: boolean;
  isApiErrorMessage?: boolean;
  origin?: { kind?: unknown };
  message?: { content?: unknown; stop_reason?: unknown };
  toolUseResult?: { taskId?: unknown; backgroundTaskId?: unknown };
}

const WATCH = /\bwatchdog(?:-exit)?\b/;
const NOTICE = /^\s*<task-notification>/;
/** The watchdog's «listening» with its hello and the harness's expiry notice: nobody spoke. */
const OWN = [...LANGS.map((l) => WATCHDOG[l].listening("").trim()), "[Monitor "];
const ownEvent = (event: string): boolean =>
  event
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .every((l) => OWN.some((p) => l.startsWith(p)) || /^\{.*"type":"hello"/.test(l));

const blocks = (e: Entry): Block[] => {
  const c = e.message?.content;
  return typeof c === "string" ? [{ type: "text", text: c }] : Array.isArray(c) ? c : [];
};
const textOf = (b: Block[]): string =>
  b.map((x) => (x.type === "text" && typeof x.text === "string" ? x.text : "")).join("\n");

/** The ids of the tasks the session's watchdogs run under. */
function watchTasks(entries: Entry[]): Set<string> {
  const calls = new Set<string>();
  const tasks = new Set<string>();
  for (const e of entries)
    for (const b of blocks(e)) {
      if (b.type === "tool_use" && WATCH.test(String(b.input?.command ?? "")))
        calls.add(String(b.id));
      if (b.type !== "tool_result" || !calls.has(String(b.tool_use_id))) continue;
      const r = e.toolUseResult;
      const id = r?.taskId ?? r?.backgroundTaskId;
      const said = typeof b.content === "string" ? b.content : textOf((b.content as Block[]) ?? []);
      const found = typeof id === "string" ? id : /\btask:? ([\w-]+)/.exec(said)?.[1];
      if (found) tasks.add(found);
    }
  return tasks;
}

/** A user entry that starts or enters a turn: what it is; null — a tool's result or the harness's own. */
function prompt(e: Entry, watch: Set<string>): "frame" | "human" | "other" | null {
  if (e.type !== "user" || e.isMeta || e.isCompactSummary) return null;
  const b = blocks(e);
  if (!b.length || b.some((x) => x.type === "tool_result")) return null;
  const text = textOf(b);
  const origin = e.origin?.kind;
  if (origin === "human") return "human";
  if (NOTICE.test(text) || origin === "task-notification") {
    const id = /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1]?.trim();
    const event = /<event>([\s\S]*?)<\/event>/.exec(text)?.[1]?.trim() ?? "";
    return id && watch.has(id) && !ownEvent(event) ? "frame" : "other";
  }
  if (marked(text)) return "frame";
  return origin === undefined ? "human" : "other";
}

const ended = (e: Entry): boolean => {
  const r = e.message?.stop_reason;
  return e.type === "assistant" && typeof r === "string" && r !== "tool_use";
};

/** The last turn of the transcript; unreadable — null. */
export function lastTurn(path: string): TurnSeen | null {
  let entries: Entry[];
  try {
    entries = readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as Entry;
        } catch {
          return {};
        }
      })
      .filter((e) => (e.type === "user" || e.type === "assistant") && !e.isSidechain);
  } catch {
    return null;
  }
  const watch = watchTasks(entries);
  const seen: TurnSeen = { framed: false, human: false, spoke: false, text: false };
  const last = [...entries].reverse().find((e) => e.type === "assistant");
  // The harness's own error in the assistant's place (a limit, a hold) is no word of the agent.
  const tail = last && !last.isApiErrorMessage ? blocks(last).at(-1) : undefined;
  seen.text = tail?.type === "text" && typeof tail.text === "string" && !!tail.text.trim();
  let prompts = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as Entry;
    if (prompts && ended(e)) break;
    const kind = prompt(e, watch);
    if (kind) prompts++;
    if (kind === "frame") seen.framed = true;
    if (kind === "human") seen.human = true;
    for (const b of e.type === "assistant" ? blocks(e) : [])
      if (b.type === "tool_use" && speaks(b.name, b.input)) seen.spoke = true;
  }
  return seen;
}
