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
//   • конец сессии: занятость снимается перед выходом (session.ts).
import { envName } from "../delivery/index.ts";
import { L } from "../shared/lang.ts";
import { scoped } from "../shared/scope.ts";
import { resolveAgainstLed, unresolvedRefusal } from "./call.ts";
import { notifiedClient } from "./client.ts";
import { CFG } from "./config.ts";
import {
  awaitHello,
  besideKeyIn,
  heldPlaces,
  holdsStanding,
  ledKey,
  listenerIdleSince,
  localListeners,
  onListenerAttached,
  parkStanding,
  readHoldRecord,
  releaseStanding,
  rememberStatus,
  resumeStanding,
} from "./hold.ts";
import { markLeft } from "./holdrecord.ts";
import { H } from "./holdstate.ts";
import { otherRealm } from "./realms.ts";
import { releaseSatelliteClaims } from "./satellite.ts";
import { publishedStatus, publishStatus } from "./status.ts";
import { emit, log } from "./streams.ts";
import { state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";
import { flushUsage, usagePlace } from "./usage.ts";

/** Порог глухоты; переменная — шов для проб, не ручка человека. */
const DEAF_MS = Number(process.env[envName("BRIDGE_DEAF_MS")]) || 15 * 60_000;
const TICK_MS = Math.min(60_000, Math.max(200, Math.floor(DEAF_MS / 5)));

const NOT_HOLDING = (): string =>
  L("мост места не держит — уходить неоткуда", "the bridge holds no seat — nothing to leave");

const clearedLine = (st: { ok: boolean; body: string }): string =>
  st.ok
    ? L("занятость снята", "busyness cleared")
    : L(`занятость не снята (${st.body})`, `busyness not cleared (${st.body})`);

/** Кадры этому харнесу доходят только через локального клиента моста. */
const deafWithoutListener = (): boolean => !notifiedClient();

const K = scoped(() => ({
  /** Строка занятости, снятая уходом, — возвращается вместе с местом. */
  status: "",
  /** Строки мест других графов, снятые тем же уходом, — каждая своему месту (#5838). */
  beside: [] as { realm: string; text: string }[],
}));

/** Уйти с места: занятость снята, сокет закрыт, место цело. Возвращает слово о сделанном. */
export async function leaveStanding(reason: string, byWord = false): Promise<string> {
  if (byWord && CFG.satellite) return leaveSatellite(reason);
  // Строки мест рядом — из их записей держания, до того как уход их снимет.
  const beside = heldPlaces()
    .filter((p) => !p.primary)
    .map((p) => ({ realm: p.realm, text: readHoldRecord(p.key)?.status ?? "" }))
    .filter((k) => k.text);
  // Сокет у мест канала общий: уход закрывает его всем — и слово называет всех (#5838).
  const leaving = heldPlaces().map((p) => p.key);
  if (leaving.length) await flushUsage(usagePlace()); // последний снимок расхода — пока место держится (#6401)
  const parked = parkStanding(reason);
  if (!parked) return NOT_HOLDING();
  K.beside = beside;
  K.status = publishedStatus();
  const st = await publishStatus("", undefined, true); // сокет закрыт у всех мест канала — и строка у всех
  // Снятая занятость остаётся в записи держания: мост, поднятый заново над
  // оставленным местом, вернёт её, только если возвращается та же сессия —
  // чужой сессии это слово прежнего держателя, и оно не публикуется (#6017).
  if (st.ok && K.status) rememberStatus(K.status);
  // Уход словом держателя держится: сторож слуха и возврат по каталогу или
  // ключу место не поднимают — только iskron_stand по имени (#6017).
  if (byWord) for (const k of leaving) markLeft(k, true);
  const line = clearedLine(st);
  log(`left the standing: ${reason}; ${line}`);
  const which =
    leaving.length > 1
      ? L(
          `с мест ${leaving.join(", ")} (сокет канала у них общий)`,
          `the seats ${leaving.join(", ")} (they share the channel socket)`,
        )
      : L(`с места ${parked}`, `the seat ${parked}`);
  return byWord
    ? L(
        `ушёл ${which}: сокет закрыт, ${line}; адрес, очередь и хуки целы — почта копится; место отпущено словом, само не вернётся — вернуть: iskron_stand тем же именем`,
        `left ${which}: the socket is closed, ${line}; address, queue and hooks intact — mail piles up; the seat is released by word and will not return by itself — to bring it back: iskron_stand with the same name`,
      )
    : L(
        `ушёл ${which}: сокет закрыт, ${line}; адрес, очередь и хуки целы — почта копится и придёт при возвращении (сторож или iskron_stand)`,
        `left ${which}: the socket is closed, ${line}; address, queue and hooks intact — mail piles up and arrives on return (the watchdog or iskron_stand)`,
      );
}

/**
 * Уход спутника словом — полный (#6361): место живёт прогоном, записи держания
 * у спутника нет, и пометка ухода не ложилась никуда — сторож слуха плагина
 * поднимал запаркованное место снова. Отпущено целиком — возвращать нечего.
 */
async function leaveSatellite(reason: string): Promise<string> {
  const place = heldPlaces()[0]?.key;
  if (!place) return NOT_HOLDING();
  await flushUsage(usagePlace());
  const st = await publishStatus("", undefined, true);
  releaseStanding(
    `${reason}: ${L("место-спутник отпущено целиком", "the satellite seat is released whole")}`,
    true,
    false,
    true,
  );
  releaseSatelliteClaims(); // имя свободно следующему прогону (satellite.ts)
  const line = clearedLine(st);
  log(`left the satellite place: ${reason}; ${line}`);
  return L(
    `ушёл с места-спутника ${place}: сокет закрыт, ${line}; место отпущено целиком — ни сторож, ни возврат его не поднимут; встать снова — iskron_stand с satellite_of`,
    `left the satellite seat ${place}: the socket is closed, ${line}; the seat is released whole — neither the watchdog nor a return will raise it; to stand again — iskron_stand with satellite_of`,
  );
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
  const text = L(
    `мост вернулся на место (${how}) — сокет открыт заново тем же адресом${K.status ? `, занятость «${K.status}» возвращена` : ""}`,
    `the bridge is back on the seat (${how}) — the socket is reopened at the same address${K.status ? `, busyness "${K.status}" restored` : ""}`,
  );
  log(text);
  if (K.status) {
    const line = K.status;
    K.status = "";
    void publishStatus(line).then((st) => {
      if (!st.ok) log(`busy line not restored after the return: ${st.body}`);
    });
  }
  // Каждое место рядом — своей строкой, не строкой основного (#5838).
  for (const k of K.beside.splice(0))
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

/**
 * Сокет, открытый заново тем же адресом (возврат, обрыв), слышит, только когда пришёл hello этого открытия; нет
 * его за срок — адрес мог повернуть другой (контур отвечает на него 404, не
 * кодом закрытия): сокет отпущен, место выбирается заново (#6706).
 */
export async function heardOnReturn(): Promise<void> {
  if (!H.unheard || (await awaitHello(4000))) return;
  const why = L(
    "сокет, открытый заново тем же адресом, не дал hello — адрес мог повернуть другой",
    "the socket reopened at the same address gave no hello — another may have turned the address",
  );
  log(why);
  H.deafKey = H.currentKey; // привязка помнится, слуха нет (deaf.ts)
  releaseStanding(why, false, false, true);
}

export function startDeafnessWatch(): void {
  // Проба живости соседнего моста (sweepStale, ownByRecord) цепляется к
  // локальному сокету и тут же отпадает — вернуть с места она не должна:
  // сторож остаётся прицепленным, проба — нет (#5140).
  onListenerAttached(() =>
    setTimeout(() => {
      if (localListeners() > 0) returnToStanding(L("прицепился сторож", "a watchdog attached"));
    }, 300).unref(),
  );
  setInterval(() => {
    const since = listenerIdleSince();
    if (since == null || !deafWithoutListener()) return;
    if (Date.now() - since < DEAF_MS) return;
    const s = state.standing;
    if (!s || !holdsStanding(s.realm, s.karta, s.name ?? "")) return;
    const min = Math.round(DEAF_MS / 60_000);
    void leaveStanding(L(`никто не слушает ${min} мин`, `nobody has listened for ${min} min`));
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
        L(
          `Отказано (мост): место ${beside} стоит на общем канале моста рядом с ${ledKey()} — уход закрыл бы сокет всем местам канала. Уйти со всех — leave в графе ${state.standing?.realm ?? "основного места"}; снять только это место — revoke.`,
          `Refused (bridge): the seat ${beside} stands on the bridge's shared channel beside ${ledKey()} — leaving would close the socket for all seats of the channel. To leave all — leave in the graph ${state.standing?.realm ?? "of the main seat"}; to remove only this seat — revoke.`,
        ),
        true,
      );
    if (state.standing && otherRealm(realm, state.standing.realm))
      return answer(
        L(
          `Отказано (мост): в графе ${String(realm)} этот мост места не держит — уходить неоткуда; его место ${ledKey()} в графе ${state.standing.realm} не тронуто.`,
          `Refused (bridge): this bridge holds no seat in the graph ${String(realm)} — nothing to leave; its seat ${ledKey()} in the graph ${state.standing.realm} is untouched.`,
        ),
        true,
      );
    return answer(await leaveStanding(L("по слову делателя", "by the doer's word"), true));
  })();
}
