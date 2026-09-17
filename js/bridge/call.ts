// Вызов тула сервера самим мостом — теми же вызовами, что и агент (stand.ts,
// resume.ts): доска, connect, register. Ответ connect впитывается мостом так
// же, как проксируемый (absorb.ts), а принятый register запоминается стоянием.
import { absorbChannelReply } from "./absorb.ts";
import { ledKey } from "./hold.ts";
import { keyOf } from "./holdrecord.ts";
import { normKarta, normName } from "./names.ts";
import { noteStanding, replyText } from "./standing.ts";
import { post, state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

/**
 * Стояние — одно на мост (граф nks-dev: #5154). Мост, ведущий место (держит
 * или запарковал), под другую роль или другое имя молча не переходит: прежде
 * holdStanding снимал родительское место с сокета, а register переписывал
 * привязку — сабагент в дочерней сессии того же моста уводил родителя. Возвращает
 * ключ ведомого места, когда просят другое, иначе null. Граф не сравнивается:
 * одно место пишут и «nks-dev», и «@nks/nks-dev», а роль с именем — один адрес.
 */
export function leadsOtherPlace(karta: unknown, name: unknown): string | null {
  const led = ledKey();
  const s = state.standing;
  if (!led || !s) return null;
  const k = normKarta(karta);
  const n = normName(name);
  // Роль: «agent» — своя по слову поверхности, что бы ни было записано; всё
  // прочее сравнивается буквально, сентинел на любой стороне проверку не
  // выключает: «me» — роль человека, не роль стояния, и с числом не совпадает;
  // мост, вставший как «me», числовой роли своим местом не считает (#5154).
  const sameKarta = k === "agent" || k === String(s.karta);
  return sameKarta && n === (s.name ?? "") ? null : led;
}

/** Слово отказа: совет по тому, ЧЕМ просимое место отличается от ведомого. */
export function otherPlaceWord(led: string, asked: string, sameName = false): string {
  const advice =
    led === asked
      ? "ключи совпали — это то же место: повтори iskron_stand с take=true, чтобы переоткрыть его сознательно"
      : sameName
        ? "то же имя под другой ролью (оно вывелось из того же каталога) — передай другое name, либо iskron_stand с take=true, чтобы сменить место этого моста"
        : "занять другое место вместо этого — iskron_stand с take=true (прежнее останется на доске без слуха; ненужное сними revoke)";
  return (
    `Отказано (мост): этот мост уже ведёт место ${led} — стояние одно на мост, и место ${asked} его сняло бы с сокета молча. ` +
    `${advice.charAt(0).toUpperCase()}${advice.slice(1)}; держать оба разом — второй мост, то есть другая сессия харнесса.`
  );
}

/** Проксируемый connect/mint/register под другое место, когда мост ведёт своё, — отказ вслух вместо тихой подмены. */
export function crossPlaceRefusal(msg: JsonRpcMessage): JsonRpcMessage | null {
  if (msg?.method !== "tools/call" || msg.params?.name !== "iskron_channel") return null;
  const a = msg.params.arguments ?? {};
  if (!["connect", "mint", "register"].includes(String(a.action))) return null;
  const karta = normKarta(a.karta ?? state.standing?.karta ?? "");
  const name = normName(a.name);
  const led = leadsOtherPlace(karta, name);
  if (!led) return null;
  const asked = keyOf(typeof a.realm === "string" ? a.realm.trim() : "", karta, name);
  const sameName = name === (state.standing?.name ?? "");
  return {
    jsonrpc: "2.0",
    id: msg.id,
    result: {
      isError: true,
      content: [{ type: "text", text: otherPlaceWord(led, asked, sameName) }],
    },
  };
}

export interface Answer {
  text: string;
  isError: boolean;
}

let seq = 0;

export async function callTool(name: string, args: Record<string, unknown>): Promise<Answer> {
  const id = `iskron-bridge-call-${++seq}`;
  const msg: JsonRpcMessage = {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  };
  let reply: JsonRpcMessage | null = null;
  await post(msg, (m) => {
    if (m.id === id) reply = m;
  });
  let got = reply as JsonRpcMessage | null;
  if (!got) return { text: "ответа нет", isError: true };
  if (name === "iskron_channel") {
    if (args.action === "register") noteStanding(msg, got);
    if (args.action === "connect") got = absorbChannelReply(msg, got);
  }
  return { text: replyText(got), isError: !!got.error || !!got.result?.isError };
}

export const short = (s: string, n = 300): string => (s.length > n ? `${s.slice(0, n)}…` : s);

// Ходы моста над местом — iskron_stand, iskron/resume, iskron/check — идут по
// одному: столкновение стояния с тиком сторожа дало бы два holdStanding и
// лишний released, по которому плагин снял бы holding (#5140).
let chain: Promise<unknown> = Promise.resolve();
export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.then(
    () => undefined,
    () => undefined,
  );
  return p;
}
