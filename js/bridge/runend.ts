// Конец места на конце сессии (граф nks-dev: #4895, #6573, #6593, #6649) — один на
// сессию: его зовёт уход (session.ts) или раньше — плагин OpenCode, кончая ведущего
// субагента (`iskron/end`, дело №147): тогда исход снятия места доходит до родителя
// словом, а уход его не повторяет.
import { L } from "../shared/lang.ts";
import { scoped } from "../shared/scope.ts";
import { leaveJoinedCases, revokeSatellitePlaces, satellitePlaces } from "./caseexit.ts";
import { CFG } from "./config.ts";
import { releaseStanding } from "./hold.ts";
import { keepHoldRecord } from "./holdkeep.ts";
import { publishStatusTo } from "./status.ts";
import { statusAddress } from "./statusaddr.ts";
import { suspended } from "./suspend.ts";
import { type JsonRpcMessage } from "./types.ts";
import { flushUsage, usagePlace } from "./usage.ts";

const R = scoped(() => ({ run: null as Promise<string[]> | null }));

/**
 * Отпустить место сессии; ответ — места-спутники, которые снять не удалось. handover —
 * демон передаёт места преемнику: место не-спутника не закрывается.
 */
export function closeRun(why: string, handover: boolean): Promise<string[]> {
  return (R.run ??= (async () => {
    // Занятость — слово ушедшего делателя: с концом сессии она снимается, иначе
    // доска показывает занятого там, где никого нет (#4895). Сокет и .key
    // отпускаются ПЕРВЫМИ, до всякого сетевого вызова, и у спутника тоже: харнес,
    // убивающий мост по короткой отсрочке, не должен застать его с живым ключом —
    // сторож ушёл бы на мёртвый сокет. Выход из дел и revoke идут вызовами сессии, сокет им не нужен.
    const addr = statusAddress();
    const places = satellitePlaces();
    // Место закрывается с сессией всегда, кроме места не-спутника, переданного преемнику:
    // у закрываемого последний снимок расхода уходит до revoke (#6401), и при смене демона.
    // Пауза спутника на перезагрузку плагина (suspend.ts): место, дела и занятость ждут нового моста.
    const paused = suspended();
    const closing = (!handover || CFG.satellite) && !paused;
    const spent = closing || paused ? usagePlace() : null;
    // Сокет стояния живёт ровно столько, сколько сессия; у спутника — и записи держания нет: возврата с диска у него не бывает.
    // У прочих запись остаётся с отсчётом срока от этого ухода (#6649).
    if (!CFG.satellite) keepHoldRecord();
    releaseStanding(why, CFG.satellite && !paused);
    // Спутник выходит из дел прогона сам (#6573), пока место на доске: конец
    // прогона — конец поручения, а истечение срока места оставило бы «slop».
    // И при смене демона без паузы (SIGTERM, мост умер): место спутника не возвращается,
    // а потерянное закрывается (#6593, #6550 п.4) — иначе на доске «живой · не слушает».
    // Передача преемнику при живом мосте ставит паузу сама (daemon.ts, pauseForHandover).
    // Последний снимок расхода ложится тем же тактом — до revoke: по закрытому месту записи нет (#6401).
    await Promise.all([paused ? null : leaveJoinedCases(), flushUsage(spent)]);
    // Конец спутника закрывает и место (#6593): место снимается с доски.
    const failed = paused ? [] : await revokeSatellitePlaces(places);
    // Спутник отпускается целиком и при передаче (возврата с диска нет) — его занятость уходит с ним.
    if (addr && closing) await publishStatusTo(addr.url, "", 3000).catch(() => {});
    return failed;
  })());
}

/** `iskron/end` — только спутнику не на паузе: конец сейчас, ответ — что снять не удалось. */
export function localEnd(msg: JsonRpcMessage): Promise<JsonRpcMessage> | null {
  if (msg?.method !== "iskron/end") return null;
  const answer = (result: unknown): JsonRpcMessage => ({ jsonrpc: "2.0", id: msg.id, result });
  if (!CFG.satellite || suspended()) return Promise.resolve(answer({ ended: false }));
  return closeRun(L("конец прогона по слову плагина", "the run's end on the plugin's word"), false)
    .then((failed) => answer({ ended: true, failed }))
    .catch((e: Error) => answer({ ended: false, word: e.message }));
}
