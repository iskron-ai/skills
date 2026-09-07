// Указание момента скилла на поверхности вызова (граф nks-dev: #4238).
//
// Скилл записи грузится в один момент, а пишется в другой; между ними его
// текст становится фоном. Описание тула — единственное, что агент читает в
// момент, когда составляет вызов, и мост, проксируя tools/list, приписывает к
// пишущим тулам строку момента. Строка не пересказывает метод: она называет
// скилл и три вещи, которые чаще всего теряются. Без ссылок на узлы графа —
// у читающего харнеса графа может не быть.
import { type JsonRpcMessage } from "./types.ts";

const WRITE_TOOL = /^iskron_(add_[a-z_]+|batch)$/;

export const MOMENT_LINE =
  "[мост] Момент скилла writing: прежде вызова — тип узла и given_as, три модуса как утверждения, " +
  "имя-тезис, стрелки со смыслом; вопрошание hint — указатель на то, чего не покажет карта, никогда план или задача; " +
  "строки CHECKS в ответе — работа, не сведение.";

/** Ответ на tools/list: к описанию каждого пишущего тула приписана строка момента. Идемпотентно. */
export function annotateToolList(reply: JsonRpcMessage): void {
  const tools = reply?.result?.tools;
  if (!Array.isArray(tools)) return;
  for (const t of tools) {
    if (!t || typeof t.name !== "string" || !WRITE_TOOL.test(t.name)) continue;
    const d = typeof t.description === "string" ? t.description : "";
    if (d.includes(MOMENT_LINE)) continue;
    t.description = d ? `${d}\n\n${MOMENT_LINE}` : MOMENT_LINE;
  }
}
