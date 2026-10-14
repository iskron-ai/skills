// A pi session's word on its turn for the seat's pulse (graph @nks/nks-dev, node #7529): busy on
// agent_start; at agent_end the turn's end (turn_at) and how it ended — the last answer's
// stopReason aborted is interrupted, error is failed, otherwise idle; read_at — a channel
// message entering the conversation (message_start of the channel's customType). Each change
// goes to the bridge by method("pulse"); the bridge paces the socket (bridge/pulse.ts).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { LOGGERS, method } from "../delivery/index.ts";
import { type Bridge } from "../shared/bridge-client.ts";

function endOf(messages: readonly any[] | undefined): "idle" | "interrupted" | "failed" {
  const last = [...(messages ?? [])].reverse().find((m) => m?.role === "assistant");
  if (last?.stopReason === "aborted") return "interrupted";
  if (last?.stopReason === "error") return "failed";
  return "idle";
}

export function setupPulse(pi: ExtensionAPI, live: () => Bridge | null): void {
  const word: { state?: string; turn_at?: string; read_at?: string } = {};
  const tell = (change: typeof word): void => {
    Object.assign(word, change);
    void live()
      ?.request(method("pulse"), word, { timeoutMs: 5_000 })
      .catch(() => {});
  };
  const at = (): string => new Date().toISOString();
  pi.on("agent_start", async () => tell({ state: "busy" }));
  pi.on("agent_end", async (event) => tell({ state: endOf(event.messages), turn_at: at() }));
  pi.on("message_start", async (event) => {
    const m: any = event.message;
    if (m?.role === "custom" && m.customType === LOGGERS.channel) tell({ read_at: at() });
  });
}

/* eslint-enable @typescript-eslint/no-explicit-any */
