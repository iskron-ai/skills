// Расход сессии pi для attrs места (граф nks-dev: #6271, #6401): на конце каждого
// хода — заполненность окна (ctx.getContextUsage), модель (ctx.model) и
// потраченное сессией по видам токенов (сумма usage ответов модели в записях
// сессии) уходят мосту запросом `iskron/usage`. Мост сам решает, стоит ли сдвиг
// вызова на сервер, и сам сбрасывает последний снимок перед уходом (bridge/usage.ts).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { type Bridge } from "../shared/bridge-client.ts";

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Потрачено сессией по видам; tokens — новые токены, без чтения кеша (reasoning входит в output). */
function spent(entries: readonly any[]): Record<string, number> {
  const s = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  for (const e of entries) {
    const u = e?.type === "message" && e.message?.role === "assistant" ? e.message.usage : null;
    if (!u) continue;
    s.input += n(u.input);
    s.output += n(u.output);
    s.cache_read += n(u.cacheRead);
    s.cache_write += n(u.cacheWrite);
  }
  return { tokens: s.input + s.output + s.cache_write, ...s };
}

export function setupUsage(pi: ExtensionAPI, live: () => Bridge | null): void {
  pi.on("turn_end", async (_event, ctx) => {
    const bridge = live();
    if (!bridge) return; // места нет — отдавать некуда
    const c: any = (ctx as any).getContextUsage?.();
    const p: Record<string, number | string> = spent(
      (ctx as any).sessionManager?.getEntries?.() ?? [],
    );
    const model: unknown = (ctx as any).model?.id;
    if (typeof model === "string" && model) p.model = model;
    if (typeof c?.tokens === "number") p.context = c.tokens;
    if (n(c?.contextWindow)) p.window = c.contextWindow;
    await bridge.request("iskron/usage", p, { timeoutMs: 10_000 }).catch(() => {});
  });
}

/* eslint-enable @typescript-eslint/no-explicit-any */
