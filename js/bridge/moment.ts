// Указание момента скилла на поверхности вызова (граф nks-dev: #4238).
//
// Скилл записи грузится в один момент, а пишется в другой; между ними его
// текст становится фоном. Описание тула — единственное, что агент читает в
// момент, когда составляет вызов, и мост, проксируя tools/list, приписывает к
// пишущим тулам строку момента. Строка не пересказывает метод: она называет
// скилл и три вещи, которые чаще всего теряются. Без ссылок на узлы графа —
// у читающего харнеса графа может не быть.
import { L } from "../shared/lang.ts";
import { STAND_TOOL_NAME, standTool } from "./stand.ts";
import { type JsonRpcMessage } from "./types.ts";

const WRITE_TOOL = /^iskron_(add_[a-z_]+|batch)$/;

// Та же строка стоит в двери iskron (карта моментов).
const jsonLine = (): string =>
  L(
    "Момент скилла writing: перед вызовом по каждому узлу назови читателя, что изменит извлечение и что здесь ново; тип и given_as, три модуса как утверждения, имя-тезис, стрелки со смыслом; тело — нынешнее знание, никогда провенанс: кто сказал, когда, чьей рукой — в истории узла и в деле, узел переписывается, а не дописывается разделом; hint — семя превращения: только важное после сессии, не журнал; вопрос соседу и ожидание — вимаршей `posed_to`, не строкой дела; строки CHECKS в ответе — работа этого такта.",
    "The writing skill's moment: before each node, name the reader, what will change retrieval and what is new here; type and given_as, the three modes as claims, a thesis name, arrows with sense; the body is present knowledge, never provenance: who said it, when, by whose hand — lives in the node's history and in the case, a node is rewritten, not appended with a section; hint is a transformation's seed: only what matters after the session, not a log; a question to a neighbour and a wait are a vimarsha with `posed_to`, not a case line; the CHECKS lines in the reply are this beat's work.",
  );

export const momentLine = (): string => L("[мост] ", "[bridge] ") + jsonLine();

/** Действие моста на тул канала: занятость стояния ставит держатель сокета — мост; основной ход — iskron_stand(status) (#6509). */
export const statusLine = (): string =>
  L(
    '[мост] Занятость ставит iskron_stand(realm, status) на месте, которое мост уже держит, — основной ход; action="status" (realm, text до 64 символов) — прежний, оставлен для совместимости: исполняет мост, держатель сокета, на сервер вызов не уходит; пустой text снимает; отказ поверхности приходит целиком.',
    '[bridge] Busyness is set by iskron_stand(realm, status) on a seat the bridge already holds — the main move; action="status" (realm, text up to 64 characters) is the former one, kept for compatibility: the bridge, the socket holder, executes it, the call does not go to the server; an empty text clears; a surface refusal comes whole.',
  );

/** Уход с места — тоже ход моста: сокет закрыт, занятость снята, место цело. */
export const leaveLine = (): string =>
  L(
    '[мост] action="leave" (realm) — уйти с места: исполняет мост — сокет закрыт, занятость снята, адрес, очередь и хуки целы; почта копится и придёт при возвращении (сторож или iskron_stand). У места-спутника субагента уход полный: место отпущено целиком, почта не копится, возврата нет — встать снова можно только iskron_stand с satellite_of. Сам мост уходит только там, где кадр доходит лишь сторожем (Claude Code, Codex) и сторож не взведён 15 минут; в pi и OpenCode кадр приходит уведомлением, и мост места не бросает. Занятость снимается на конце сессии.',
    '[bridge] action="leave" (realm) — leave the seat: the bridge executes it — the socket is closed, busyness cleared, address, queue and hooks intact; mail piles up and arrives on return (the watchdog or iskron_stand). For a subagent\'s satellite seat the leave is total: the seat is released whole, mail does not pile up, there is no return — standing again is only iskron_stand with satellite_of. The bridge itself leaves only where a frame reaches only through a watchdog (Claude Code, Codex) and the watchdog has not been armed for 15 minutes; in pi and OpenCode a frame comes as a notification, and the bridge does not abandon the seat. Busyness clears at the end of the session.',
  );

/** Ответ на tools/list: к описанию каждого пишущего тула приписана строка момента. Идемпотентно. */
export function annotateToolList(reply: JsonRpcMessage): void {
  const tools = reply?.result?.tools;
  if (!Array.isArray(tools)) return;
  // Тул моста — в списке той же сессии: его нет без моста, и это знак транспорта.
  // Всегда определение ЭТОЙ сборки: список из общего кэша мог записать мост другой.
  const at = tools.findIndex((t) => t?.name === STAND_TOOL_NAME);
  if (at >= 0) tools[at] = standTool();
  else tools.push(standTool());
  // Строки моста — в НАЧАЛО описания: Claude Code режет описание тула до 2048
  // знаков, а описания пишущих тулов сервера длиннее — в хвосте строку не видно.
  for (const t of tools) {
    if (t && t.name === "iskron_channel" && typeof t.description === "string") {
      if (!t.description.includes(leaveLine()))
        t.description = `${leaveLine()}\n\n${t.description}`;
      if (!t.description.includes(statusLine()))
        t.description = `${statusLine()}\n${t.description}`;
      continue;
    }
    if (!t || typeof t.name !== "string" || !WRITE_TOOL.test(t.name)) continue;
    const d = typeof t.description === "string" ? t.description : "";
    if (d.includes(momentLine())) continue;
    t.description = d ? `${momentLine()}\n\n${d}` : momentLine();
  }
}
