// Место роли без имени (граф nks-dev: #6748): сервер принимает connect, mint и
// register с пустым name и ставит место «@handle» — адрес совпадает с местом
// человека, а revoke снять его нечем. Мост такого вызова не шлёт ни одним путём:
// ни ходом агента, ни своим (iskron_stand, в том числе с невыведшимся именем,
// возврат места, пауза спутника, перерегистрация) — проверка стоит на выходе к
// серверу (transport.ts).
import { L } from "../shared/lang.ts";
import { normName } from "./names.ts";
import { type JsonRpcMessage } from "./types.ts";

const SEAT_MOVES = new Set(["connect", "mint", "register"]);

const word = (action: string): string =>
  L(
    `Отказано (мост): ${action} без имени места — место роли с пустым именем мост не занимает (его адрес совпал бы с местом человека, а снять его нечем); вызов не отправлен. Назови место явно: name (строчные латинские буквы, цифры, «.», «_», «-»).`,
    `Refused (bridge): ${action} without a seat name — the bridge does not take a role seat with an empty name (its address would coincide with the human's seat, and nothing could take it off); the call was not sent. Name the seat explicitly: name (lower-case Latin letters, digits, «.», «_», «-»).`,
  );

/** Вызов, занимающий место без имени, — отказ вслух вместо отправки; иначе null. */
export function unnamedSeatRefusal(msg: JsonRpcMessage): JsonRpcMessage | null {
  if (msg?.method !== "tools/call" || msg.params?.name !== "iskron_channel") return null;
  const a = msg.params.arguments ?? {};
  const action = String(a.action);
  if (!SEAT_MOVES.has(action) || normName(a.name)) return null;
  return {
    jsonrpc: "2.0",
    id: msg.id,
    result: { isError: true, content: [{ type: "text", text: word(action) }] },
  };
}
