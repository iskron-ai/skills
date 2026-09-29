// Расход сессии pi для attrs места (граф nks-dev: #6271): на конце каждого хода —
// заполненность окна (ctx.getContextUsage) и потраченное сессией (сумма usage
// ответов модели в записях сессии) уходят мосту запросом `iskron/usage`. Мост
// сам решает, стоит ли сдвиг вызова на сервер (bridge/usage.ts).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { type Bridge } from "../shared/bridge-client.ts";

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Потрачено сессией: новые токены ответов модели — без чтения кеша (reasoning входит в output). */
function spent(entries: readonly any[]): number {
  let sum = 0;
  for (const e of entries) {
    const u = e?.type === "message" && e.message?.role === "assistant" ? e.message.usage : null;
    if (u) sum += n(u.input) + n(u.output) + n(u.cacheWrite);
  }
  return sum;
}

export function setupUsage(pi: ExtensionAPI, live: () => Bridge | null): void {
  pi.on("turn_end", async (_event, ctx) => {
    const bridge = live();
    if (!bridge) return; // места нет — отдавать некуда
    const c: any = (ctx as any).getContextUsage?.();
    const p: Record<string, number> = {
      tokens: spent((ctx as any).sessionManager?.getEntries?.() ?? []),
    };
    if (typeof c?.tokens === "number") p.context = c.tokens;
    if (n(c?.contextWindow)) p.window = c.contextWindow;
    await bridge.request("iskron/usage", p, { timeoutMs: 10_000 }).catch(() => {});
  });
}

/* eslint-enable @typescript-eslint/no-explicit-any */
