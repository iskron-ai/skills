// Ключи attrs.usage места (граф nks-dev: #6401): каждый необязателен, числа —
// целые токены. Снимок без единой цифры и без модели — не снимок: такого usage
// у места нет вовсе, а не нули.

export interface Usage {
  /** Токенов потрачено сессией. */
  tokens?: number;
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  /** Модель последнего шага — как её называет харнес. */
  model?: string;
  /** Токенов в окне контекста сейчас. */
  context?: number;
  /** Размер окна модели. */
  window?: number;
  /** context / window, целые проценты. */
  percent?: number;
  /** Когда снято, ISO. */
  at: string;
}

const SPENT = ["tokens", "input", "output", "cache_read", "cache_write"] as const;

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;

/** Снимок из параметров `iskron/usage`; null — ни цифры, ни модели. */
export function usageOf(p: Record<string, unknown>): Usage | null {
  const u: Omit<Usage, "at"> = {};
  for (const k of SPENT) {
    const v = num(p[k]);
    if (v !== undefined) u[k] = v;
  }
  if (typeof p.model === "string" && p.model.trim()) u.model = p.model.trim().slice(0, 120);
  const context = num(p.context);
  const window = num(p.window);
  if (context !== undefined) u.context = context;
  if (window) u.window = window;
  if (context !== undefined && window) u.percent = Math.round((100 * context) / window);
  return Object.keys(u).length ? { ...u, at: new Date().toISOString() } : null;
}

/** Сдвиг, ради которого стоит вызова на сервер: 5 п.п. окна, 10% потраченного, другие окно или модель. */
export function moved(a: Usage | null, b: Usage): boolean {
  if (!a) return true;
  if (a.percent !== undefined && b.percent !== undefined && Math.abs(b.percent - a.percent) >= 5)
    return true;
  if (b.tokens !== undefined && (a.tokens === undefined || b.tokens >= a.tokens * 1.1 + 1))
    return true;
  return a.window !== b.window || (b.model !== undefined && a.model !== b.model);
}
