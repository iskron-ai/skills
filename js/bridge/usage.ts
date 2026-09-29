// Расход сессии в attrs места (граф nks-dev: #6271): плагин OpenCode и
// расширение pi отдают мосту цифры запросом `iskron/usage`, мост кладёт их
// ключом usage в полный набор attrs (placefields.ts) и повторяет register
// своего места — не чаще раза в минуту и только при заметном сдвиге: register
// — вызов на сервер, а цифры меняются каждый шаг.
import { isParked } from "./hold.ts";
import { rememberUsage } from "./placefields.ts";
import { replayRegister } from "./standing.ts";
import { log } from "./streams.ts";
import { state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

export interface Usage {
  /** Токенов потрачено сессией. */
  tokens?: number;
  /** Токенов в окне контекста сейчас. */
  context?: number;
  /** Размер окна модели. */
  window?: number;
  /** context / window, целые проценты. */
  percent?: number;
  /** Когда снято, ISO. */
  at: string;
}

const MIN_GAP_MS = Number(process.env.ISKRON_USAGE_GAP_MS || 60_000);

let published: Usage | null = null;
let publishedAt = 0;

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;

/** Сдвиг, ради которого стоит вызова на сервер: 5 п.п. окна или 10% потраченного. */
function moved(a: Usage | null, b: Usage): boolean {
  if (!a) return true;
  if (a.percent !== undefined && b.percent !== undefined && Math.abs(b.percent - a.percent) >= 5)
    return true;
  if (b.tokens !== undefined && (a.tokens === undefined || b.tokens >= a.tokens * 1.1 + 1))
    return true;
  return a.window !== b.window;
}

export const isUsageCall = (msg: JsonRpcMessage): boolean => msg?.method === "iskron/usage";

/** `iskron/usage {tokens?, context?, window?}` — запомнить и, когда пора, переписать attrs места. */
export async function runUsage(msg: JsonRpcMessage): Promise<JsonRpcMessage> {
  const p = (msg.params ?? {}) as Record<string, unknown>;
  const u: Usage = { at: new Date().toISOString() };
  const tokens = num(p.tokens);
  const context = num(p.context);
  const window = num(p.window);
  if (tokens !== undefined) u.tokens = tokens;
  if (context !== undefined) u.context = context;
  if (window) u.window = window;
  if (context !== undefined && window) u.percent = Math.round((100 * context) / window);
  rememberUsage(u);
  let pushed = false;
  const s = state.standing;
  // Ушёл с места (leave) — register вернул бы привязку отпущенного места; цифры едут со следующим занятием.
  const away = !!s && isParked(s.realm, s.karta, s.name ?? "");
  if (s && !away && Date.now() - publishedAt >= MIN_GAP_MS && moved(published, u)) {
    publishedAt = Date.now();
    const got = await replayRegister(s);
    pushed = !!got && !got.error && !got.result?.isError;
    if (pushed) published = u;
    else
      log(
        `usage: register did not take the attrs this time — ${JSON.stringify(got?.error ?? got?.result ?? null).slice(0, 200)}`,
      );
  }
  return { jsonrpc: "2.0", id: msg.id, result: { pushed, usage: u } };
}
