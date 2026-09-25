// Уход с места — ход между отлучкой и снятием (граф nks-dev: #4895).
//
// Отлучка на мосту не прекращала доставку: сокет держит мост, пока жива
// сессия, и место читается с доски «слушает», хотя делатель ушёл — контекст
// забился, сторож не взведён, сессия закрыта. Снятие (revoke) прекращает
// доставку ценой адреса и хуков. Здесь третье: сокет закрыт, занятость снята,
// адрес, очередь и хуки целы; почта копится у платформы и придёт лежалым
// хвостом, когда делатель вернётся — сторожем к тому же сокету или iskron_stand.
//
// Три повода уйти, все — движения моста:
//   • слово делателя: iskron_channel(action="leave") — исполняет мост;
//   • глухота: харнес слышит кадры только через локального клиента (сторож под
//     Monitor в Claude Code, watchdog-codex в Codex), а его нет дольше порога —
//     место читалось бы слушающим при делателе, которого не разбудить;
//     pi и OpenCode кадр получают уведомлением и глухими не бывают;
//   • конец сессии: занятость снимается перед выходом (main.ts).
import { resolveAgainstLed, unresolvedRefusal } from "./call.ts";
import { notifiedClient } from "./client.ts";
import {
  besideKeyIn,
  heldPlaces,
  holdsStanding,
  ledKey,
  listenerIdleSince,
  localListeners,
  onListenerAttached,
  parkStanding,
  readHoldRecord,
  rememberStatus,
  resumeStanding,
} from "./hold.ts";
import { markLeft } from "./holdrecord.ts";
import { otherRealm } from "./realms.ts";
import { publishedStatus, publishStatus } from "./status.ts";
import { emit, log } from "./streams.ts";
import { state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

/** Порог глухоты; переменная — шов для проб, не ручка человека. */
const DEAF_MS = Number(process.env.ISKRON_BRIDGE_DEAF_MS) || 15 * 60_000;
const TICK_MS = Math.min(60_000, Math.max(200, Math.floor(DEAF_MS / 5)));

/** Кадры этому харнесу доходят только через локального клиента моста. */
const deafWithoutListener = (): boolean => !notifiedClient();

/** Строка занятости, снятая уходом, — возвращается вместе с местом. */
let keptStatus = "";
/** Строки мест других графов, снятые тем же уходом, — каждая своему месту (#5838). */
let keptBeside: { realm: string; text: string }[] = [];

/** Уйти с места: занятость снята, сокет закрыт, место цело. Возвращает слово о сделанном. */
export async function leaveStanding(reason: string, byWord = false): Promise<string> {
  // Строки мест рядом — из их записей держания, до того как уход их снимет.
  const beside = heldPlaces()
    .filter((p) => !p.primary)
    .map((p) => ({ realm: p.realm, text: readHoldRecord(p.key)?.status ?? "" }))
    .filter((k) => k.text);
  // Сокет у мест канала общий: уход закрывает его всем — и слово называет всех (#5838).
  const leaving = heldPlaces().map((p) => p.key);
  const parked = parkStanding(reason);
  if (!parked) return "мост места не держит — уходить неоткуда";
  keptBeside = beside;
  keptStatus = publishedStatus();
  const st = await publishStatus("", undefined, true); // сокет закрыт у всех мест канала — и строка у всех
  // Снятая занятость остаётся в записи держания: мост, поднятый заново над
  // оставленным местом, вернёт её, только если возвращается та же сессия —
  // чужой сессии это слово прежнего держателя, и оно не публикуется (#6017).
  if (st.ok && keptStatus) rememberStatus(keptStatus);
  // Уход словом держателя держится: сторож слуха и возврат по каталогу или
  // ключу место не поднимают — только iskron_stand по имени (#6017).
  if (byWord) for (const k of leaving) markLeft(k, true);
  const line = st.ok ? "занятость снята" : `занятость не снята (${st.body})`;
  log(`left the standing: ${reason}; ${line}`);
  const which =
    leaving.length > 1
      ? `с мест ${leaving.join(", ")} (сокет канала у них общий)`
      : `с места ${parked}`;
  return byWord
    ? `ушёл ${which}: сокет закрыт, ${line}; адрес, очередь и хуки целы — почта копится; место отпущено словом, само не вернётся — вернуть: iskron_stand тем же именем`
    : `ушёл ${which}: сокет закрыт, ${line}; адрес, очередь и хуки целы — почта копится и придёт при возвращении (сторож или iskron_stand)`;
}

/**
 * Сторож глухоты: раз в такт смотрит, слушает ли кто мост; никого дольше
 * порога при харнесе, которому кадры доходят только сторожем, — уходит с места.
 * Возвращение — прицепившийся сторож: место открывается заново тем же адресом.
 */
/**
 * Вернуться на место, с которого уходили: сокет заново, снятая занятость — обратно
 * (её сменит только новое слово делателя). Возвращает false, если уходить не уходили.
 */
export function returnToStanding(how: string): boolean {
  if (!resumeStanding()) return false;
  for (const p of heldPlaces()) markLeft(p.key, false); // на месте снова — пометка ухода словом снята
  const text = `мост вернулся на место (${how}) — сокет открыт заново тем же адресом${keptStatus ? `, занятость «${keptStatus}» возвращена` : ""}`;
  log(text);
  if (keptStatus) {
    const line = keptStatus;
    keptStatus = "";
    void publishStatus(line).then((st) => {
      if (!st.ok) log(`busy line not restored after the return: ${st.body}`);
    });
  }
  // Каждое место рядом — своей строкой, не строкой основного (#5838).
  for (const k of keptBeside.splice(0))
    void publishStatus(k.text, k.realm).then((st) => {
      if (!st.ok) log(`busy line of ${k.realm} not restored after the return: ${st.body}`);
    });
  emit({
    jsonrpc: "2.0",
    method: "notifications/message",
    params: { level: "info", logger: "iskron-channel", data: { kind: "note", text } },
  });
  return true;
}

export function startDeafnessWatch(): void {
  // Проба живости соседнего моста (sweepStale, deadPredecessor) цепляется к
  // локальному сокету и тут же отпадает — вернуть с места она не должна:
  // сторож остаётся прицепленным, проба — нет (#5140).
  onListenerAttached(() =>
    setTimeout(() => {
      if (localListeners() > 0) returnToStanding("прицепился сторож");
    }, 300).unref(),
  );
  setInterval(() => {
    const since = listenerIdleSince();
    if (since == null || !deafWithoutListener()) return;
    if (Date.now() - since < DEAF_MS) return;
    const s = state.standing;
    if (!s || !holdsStanding(s.realm, s.karta, s.name ?? "")) return;
    void leaveStanding(`никто не слушает ${Math.round(DEAF_MS / 60_000)} мин`);
  }, TICK_MS).unref();
}

/** action="leave" у iskron_channel — слово делателя, исполняет мост. */
export function localLeave(msg: JsonRpcMessage): Promise<JsonRpcMessage> | null {
  if (msg?.method !== "tools/call" || msg?.params?.name !== "iskron_channel") return null;
  if (msg.params?.arguments?.action !== "leave") return null;
  const realm: unknown = msg.params.arguments.realm;
  const answer = (text: string, isError = false): JsonRpcMessage => ({
    jsonrpc: "2.0",
    id: msg.id,
    result: { ...(isError ? { isError: true } : {}), content: [{ type: "text", text }] },
  });
  return (async () => {
    await resolveAgainstLed(realm); // граф вызова и граф места — в одной форме (#5838)
    const unresolved = unresolvedRefusal(realm);
    if (unresolved) return answer(unresolved, true);
    // Сокет у мест канала общий (#5838): уход места другого графа закрыл бы слух всем — отказ вслух.
    const beside = besideKeyIn(realm);
    if (beside)
      return answer(
        `Отказано (мост): место ${beside} стоит на общем канале моста рядом с ${ledKey()} — уход закрыл бы сокет всем местам канала. Уйти со всех — leave в графе ${state.standing?.realm ?? "основного места"}; снять только это место — revoke.`,
        true,
      );
    if (state.standing && otherRealm(realm, state.standing.realm))
      return answer(
        `Отказано (мост): в графе ${String(realm)} этот мост места не держит — уходить неоткуда; его место ${ledKey()} в графе ${state.standing.realm} не тронуто.`,
        true,
      );
    return answer(await leaveStanding("по слову делателя", true));
  })();
}
