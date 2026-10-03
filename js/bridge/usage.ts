// Расход сессии в attrs места (граф nks-dev: #6271, #6401): плагин OpenCode и
// расширение pi отдают мосту цифры запросом `iskron/usage`, мост кладёт их
// ключом usage в полный набор attrs (placefields.ts) и повторяет register
// своего места — по ходу сессии не чаще раза в минуту и только при заметном
// сдвиге: register — вызов на сервер, а цифры меняются каждый шаг. Последний
// снимок уходит в обход порога перед уходом с места и перед его закрытием:
// по закрытому месту запись — 404, и снимок после закрытия не ляжет.
// Claude Code и Codex цифр не дают — их месту usage не пишется вовсе.
import { HOSTED_CLIENTS } from "../shared/clients.ts";
import { L } from "../shared/lang.ts";
import { scoped } from "../shared/scope.ts";
import { harnessName } from "./client.ts";
import { isParked } from "./hold.ts";
import { rememberUsage } from "./placefields.ts";
import { replayRegister } from "./standing.ts";
import { log } from "./streams.ts";
import { type Standing, state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";
import { moved, type Usage, usageOf } from "./usagefields.ts";

const MIN_GAP_MS = Number(process.env.ISKRON_USAGE_GAP_MS || 60_000);
/** Потолок последнего снимка: харнес гасит мост по короткой отсрочке. */
const FLUSH_CAP_MS = Number(process.env.ISKRON_CASE_LEAVE_MS) || 1_500;

const U = scoped(() => ({ published: null as Usage | null, latest: null as Usage | null, at: 0 }));

export const isUsageCall = (msg: JsonRpcMessage): boolean => msg?.method === "iskron/usage";

/** Место, которому идёт расход: держимое, не оставленное уходом. */
export function usagePlace(): Standing | null {
  const s = state.standing;
  // Ушёл с места (leave) — register вернул бы привязку отпущенного места; цифры едут со следующим занятием.
  return s && !isParked(s.realm, s.karta, s.name ?? "") ? s : null;
}

/** register места с последним снимком; true — attrs приняты. */
async function publish(place: Standing, u: Usage): Promise<boolean> {
  U.at = Date.now();
  const got = await replayRegister(place);
  const ok = !!got && !got.error && !got.result?.isError;
  if (ok) U.published = u;
  else
    log(
      `usage: register did not take the attrs this time — ${JSON.stringify(got?.error ?? got?.result ?? null).slice(0, 200)}`,
    );
  return ok;
}

/** `iskron/usage {tokens?, input?, output?, cache_read?, cache_write?, model?, context?, window?}`. */
export async function runUsage(msg: JsonRpcMessage): Promise<JsonRpcMessage> {
  const answer = (result: Record<string, unknown>): JsonRpcMessage => ({
    jsonrpc: "2.0",
    id: msg.id,
    result,
  });
  if (!HOSTED_CLIENTS.has(harnessName()))
    return answer({
      pushed: false,
      usage: null,
      why: L("расход пишут только OpenCode и pi", "only OpenCode and pi report usage"),
    });
  const u = usageOf((msg.params ?? {}) as Record<string, unknown>);
  if (!u)
    return answer({
      pushed: false,
      usage: null,
      why: L("в снимке нет цифр", "the snapshot has no numbers"),
    });
  U.latest = u;
  rememberUsage(u);
  const s = usagePlace();
  const due = !!s && Date.now() - U.at >= MIN_GAP_MS && moved(U.published, u);
  return answer({ pushed: due && s ? await publish(s, u) : false, usage: u });
}

/**
 * Последний снимок — в обход порога, строго до закрытия места: перед leave и
 * перед revoke спутника на конце прогона. Нечего или уже лежит — молчит.
 */
export async function flushUsage(place: Standing | null): Promise<void> {
  const u = U.latest;
  if (!place || !u || u === U.published) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<"cap">((r) => (timer = setTimeout(() => r("cap"), FLUSH_CAP_MS)));
  const got = await Promise.race([publish(place, u), cap]);
  clearTimeout(timer);
  if (got === "cap")
    log(`usage: the last snapshot exceeded ${FLUSH_CAP_MS} ms before the place went`);
}
