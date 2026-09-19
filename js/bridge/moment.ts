// Указание момента скилла на поверхности вызова (граф nks-dev: #4238).
//
// Скилл записи грузится в один момент, а пишется в другой; между ними его
// текст становится фоном. Описание тула — единственное, что агент читает в
// момент, когда составляет вызов, и мост, проксируя tools/list, приписывает к
// пишущим тулам строку момента. Строка не пересказывает метод: она называет
// скилл и три вещи, которые чаще всего теряются. Без ссылок на узлы графа —
// у читающего харнеса графа может не быть.
import { STAND_TOOL } from "./stand.ts";
import { type JsonRpcMessage } from "./types.ts";

const WRITE_TOOL = /^iskron_(add_[a-z_]+|batch)$/;

// Та же строка стоит в двери iskron (карта моментов).
const JSON_LINE =
  "Момент скилла writing: перед вызовом по каждому узлу назови читателя, что изменит извлечение и что здесь ново; тип и given_as, три модуса как утверждения, имя-тезис, стрелки со смыслом; hint — семя превращения: только важное после сессии, не журнал; гроссбух сессии — в файле сессии и в кадре; строки CHECKS в ответе — работа этого такта.";

export const MOMENT_LINE = "[мост] " + JSON_LINE;

/** Ответ на tools/list: к описанию каждого пишущего тула приписана строка момента. Идемпотентно. */
/** Действие моста на тул канала: занятость стояния ставит держатель сокета — мост. */
export const STATUS_LINE =
  '[мост] action="status" (realm, text до 64 символов) — занятость ЭТОГО стояния: исполняет мост, держатель сокета, на сервер вызов не уходит; пустой text снимает; отказ поверхности приходит целиком.';

/** Уход с места — тоже ход моста: сокет закрыт, занятость снята, место цело. */
export const LEAVE_LINE =
  '[мост] action="leave" (realm) — уйти с места: исполняет мост — сокет закрыт, занятость снята, адрес, очередь и хуки целы; почта копится и придёт при возвращении (сторож или iskron_stand). Сам мост уходит только там, где кадр доходит лишь сторожем (Claude Code, Codex) и сторож не взведён 15 минут; в pi и OpenCode кадр приходит уведомлением, и мост места не бросает. Занятость снимается на конце сессии.';

export function annotateToolList(reply: JsonRpcMessage): void {
  const tools = reply?.result?.tools;
  if (!Array.isArray(tools)) return;
  // Тул моста — в списке той же сессии: его нет без моста, и это знак транспорта.
  // Всегда определение ЭТОЙ сборки: список из общего кэша мог записать мост другой.
  const at = tools.findIndex((t) => t?.name === STAND_TOOL.name);
  if (at >= 0) tools[at] = STAND_TOOL;
  else tools.push(STAND_TOOL);
  for (const t of tools) {
    if (t && t.name === "iskron_channel" && typeof t.description === "string") {
      if (!t.description.includes(STATUS_LINE))
        t.description = `${t.description}\n\n${STATUS_LINE}`;
      if (!t.description.includes(LEAVE_LINE)) t.description = `${t.description}\n${LEAVE_LINE}`;
      continue;
    }
    if (!t || typeof t.name !== "string" || !WRITE_TOOL.test(t.name)) continue;
    const d = typeof t.description === "string" ? t.description : "";
    if (d.includes(MOMENT_LINE)) continue;
    t.description = d ? `${d}\n\n${MOMENT_LINE}` : MOMENT_LINE;
  }
}
