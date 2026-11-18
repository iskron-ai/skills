// The start word of a dsh session (graph @nks/nks-dev, node #10921): on the session's first
// agent/created the cover of the session's repository (shared/ritualcover.ts, the same reading
// as OpenCode's rites) names the graph and the role, and the word goes into the agent's system
// prompt — an agent-local section of payload.agent.ctx.systemPrompt, observed live on
// 0.2.2-rc.1 to reach the system message of every model request of that agent and to go with
// it. A resumed session hears why: its seat went with the last process. No cover, another
// delivery's cover, the start ritual switched off — silence; an unsupported cover contract is
// warned of all the same, and a repository with no sign of alignment (shared/reposigns.ts)
// hears the onboarding invitation (#11071).
/* eslint-disable @typescript-eslint/no-explicit-any -- dsh SDK objects without a schema */
import { DSH, ONBOARD_START } from "../delivery/index.ts";
import { repoContractWarning } from "../shared/covercontract.ts";
import { wordsIn } from "../shared/lang.ts";
import { repoSigns } from "../shared/reposigns.ts";
import { ritualCover, startWord } from "../shared/ritualcover.ts";

/** The section's name in the agent's prompt registry. */
export const START_SECTION = "delivery:start";
/** After the persona's suffix (10200): the word closes the system prompt. */
const ORDER = 10300;

/** The word for a session started (startup) or continued (resume) in dir; else null. An
 * unsupported cover contract is warned of first, the start ritual on or off — as OpenCode's
 * and Claude Code's start (shared/covercontract.ts). */
export function startText(dir: string, source: unknown): string | null {
  if (source !== "startup" && source !== "resume") return null;
  const cover = ritualCover(dir);
  const warning = repoContractWarning(dir, cover?.lang);
  const W = wordsIn(DSH, cover?.lang);
  const start = cover?.on.has("start")
    ? [startWord(cover), source === "resume" ? W.startResumed() : W.startListen()].join("\n\n")
    : null;
  // A repository never aligned for the agent: the invitation, after the seat's word (#11071).
  const invite =
    repoSigns(dir, "dsh").verdict === "invite" ? wordsIn(ONBOARD_START, cover?.lang).start() : null;
  return [warning, start, invite].filter(Boolean).join("\n\n") || null;
}

/**
 * Put the start word into the agent's system prompt; true when a section was registered.
 * A missing registry or a failed registration is said on log and is not retried.
 */
export function putStartWord(
  agent: any,
  source: unknown,
  dir: string,
  log: (why: string) => void,
): boolean {
  const text = startText(dir, source);
  const prompt = agent?.ctx?.systemPrompt;
  if (!text) return false;
  if (typeof prompt?.section !== "function") {
    log("agent.ctx.systemPrompt.section is absent"); // the surface moved: say it, not guess
    return false;
  }
  try {
    prompt.section({ name: START_SECTION, order: ORDER, text, interpolate: false });
    return true;
  } catch (e) {
    log((e as Error).message);
    return false;
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */
