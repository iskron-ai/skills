// Пауза спутника на перезагрузку плагина OpenCode (граф nks-dev: #6625; #6550,
// правило 3). Плагин, которого перезагружают, гасит мосты субагентов, а конец
// спутника выводит его из дел и снимает место (session.ts) — так перезагрузка
// кончала бы ребёнка, чьё поручение не кончено. Запрос `iskron/suspend` до
// остановки: мост пишет запись паузы (pauserecord.ts) и уходит, не выходя из дел,
// не снимая места и занятости. Мост нового экземпляра возвращает место по ключу
// (`iskron/resume`, resume.ts) и принимает дела прогона — на своём конце он их и покинет.
import { L } from "../shared/lang.ts";
import { callTool as call } from "./call.ts";
import { seedJoined } from "./caseexit.ts";
import { CFG } from "./config.ts";
import { parkStanding, releaseStanding } from "./hold.ts";
import { HOLD_RECORD_MAX_AGE_MS, readHoldRecord } from "./holdrecord.ts";
import { H } from "./holdstate.ts";
import { P, pauseRecord } from "./pauserecord.ts";
import { placeFields } from "./placefields.ts";
import { sleep } from "./store.ts";
import { log } from "./streams.ts";
import { state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

export { suspended } from "./pauserecord.ts";

/** `iskron/suspend` — только спутнику, держащему место; ответ — ключ записи паузы. */
export function localSuspend(msg: JsonRpcMessage): Promise<JsonRpcMessage> | null {
  if (msg?.method !== "iskron/suspend") return null;
  const answer = (result: unknown): JsonRpcMessage => ({ jsonrpc: "2.0", id: msg.id, result });
  const s = state.standing;
  // Пауза передачи демона (pauserecord.ts), а харнес просит свою: она становится паузой
  // харнеса — тот же перевзвод окна, занятость ждёт; сокет места уже отпущен передаче.
  const drained = P.kind === "handover";
  if (drained) P.kind = "suspend";
  else if (P.kind && P.answer) return Promise.resolve(answer({ suspended: true, ...P.answer }));
  const key = drained ? (P.answer?.key ?? null) : pauseRecord("suspend");
  if (!key || !s)
    return Promise.resolve(
      answer({
        suspended: false,
        word: L("места-спутника нет — паузы нет", "no satellite seat — nothing to pause"),
      }),
    );
  return rearmForPause(s, drained).then((rearmed) => {
    if (rearmed) P.write?.();
    log(
      `satellite paused for a plugin reload${drained ? " in the daemon handover" : ""}: ${key}, cases ${P.answer?.cases ?? 0} — place and cases kept, idle window ${rearmed ? `${PAUSE_TTL_S} s` : "unchanged"}`,
    );
    return answer({ suspended: true, ...P.answer });
  });
}

/**
 * Окно простоя места на паузе — срок записи держания (#6550 п.3; #147 [140]): окно
 * спутника (SATELLITE_TTL_S, 300 с) погасило бы место перезагрузки дольше пяти минут.
 * ttl задаёт только connect, а он переиздаёт сокет и вытесняет живой (4000) — поэтому
 * сперва уход с сокета, затем connect; новый адрес держит мост и пишет запись. В окне
 * передачи демона (drained) сокет уже у передачи: connect вытесняет его, а новый сокет
 * отдаётся передаче же, с занятостью. Отказ или потолок — окно прежнее, место ждёт им.
 */
const PAUSE_TTL_S = Math.floor(HOLD_RECORD_MAX_AGE_MS / 1000);
const REARM_CAP_MS = 1_000;

async function rearmForPause(
  s: { realm: string; karta: string | number; name?: string | null },
  drained: boolean,
) {
  const name = s.name ?? "";
  if (!drained && !parkStanding(L("пауза спутника", "satellite pause"))) return false;
  const args = {
    action: "connect",
    realm: s.realm,
    karta: s.karta,
    name,
    ...placeFields({ realm: s.realm, karta: String(s.karta), name }),
    ttl_seconds: PAUSE_TTL_S,
  };
  // Ответ connect берёт мост (absorb.ts): новый адрес — в H, отсюда — в запись паузы.
  const connect = call("iskron_channel", args).then((r) => {
    if (!r.isError && H.currentUrl) P.turned = { url: H.currentUrl, statusUrl: H.currentStatusUrl };
    if (drained) {
      // Сессия ушла — сокет, открытый ответом, держит передача, а запись идёт за адресом.
      releaseStanding(L("пауза спутника", "satellite pause"), false, false, false, true);
      P.write?.();
    }
    return r;
  });
  P.connect = connect;
  const r = await Promise.race([connect, sleep(REARM_CAP_MS).then(() => null)]);
  if (!r || r.isError)
    log(`satellite pause: idle window not re-armed — ${r?.text ?? "no answer yet"}`);
  return !!r && !r.isError && !!P.turned;
}

/** Ожидание перевзвода на конце сессии — под отсрочкой харнеса (OpenCode гасит мост через 5 с). */
const SETTLE_CAP_MS = 3_000;

/**
 * Конец моста на паузе (session.ts), после вызовов в полёте: connect, проигравший
 * потолок, сервер всё равно исполнит — адрес повёрнут, а в записи прежний, мёртвый
 * (#147 [145]); вход в дело, ответивший после паузы, в записи ещё нет. Дождаться
 * перевзвода и переписать запись свежими адресом и делами.
 */
export async function pauseSettled(): Promise<void> {
  if (!P.kind) return;
  if (P.connect) await Promise.race([P.connect.catch(() => {}), sleep(SETTLE_CAP_MS)]);
  const turned = !!P.turned && P.turned.url !== P.written;
  P.write?.();
  if (turned)
    log(`satellite pause: the late re-arm turned the address — the pause record follows it`);
}

/** Возврат по ключу удался: дела прогона из записи паузы — этому мосту. */
export function afterResume(key: string | undefined): void {
  if (!CFG.satellite || !key) return;
  seedJoined(readHoldRecord(key)?.cases);
}
