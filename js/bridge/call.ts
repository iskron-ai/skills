// Вызов тула сервера самим мостом — теми же вызовами, что и агент (stand.ts,
// resume.ts): доска, connect, register. Ответ connect впитывается мостом так
// же, как проксируемый (absorb.ts), а принятый register запоминается стоянием.
import { L } from "../shared/lang.ts";
import { absorbChannelReply } from "./absorb.ts";
import { holdsChannel, ledKey } from "./hold.ts";
import { keyOf } from "./holdrecord.ts";
import { normKarta, normName } from "./names.ts";
import { noteLocaleEcho } from "./placefields.ts";
import { extraIn } from "./places.ts";
import { canonRealm, otherRealm, resolveRealms, unknownRealm, unresolvedWord } from "./realms.ts";
import { noteStanding, replyText } from "./standing.ts";
import { post, state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

/**
 * В графе место одно на мост (граф nks-dev: #5154). Мост, ведущий место (держит
 * или запарковал), под другую роль или другое имя того же графа молча не
 * переходит: прежде holdStanding снимал родительское место с сокета, а register
 * переписывал привязку — сабагент в дочерней сессии того же моста уводил
 * родителя. Место в ДРУГОМ графе встаёт рядом на том же канале (#5838) — там
 * правило сличает с местом того графа, если мост его уже ведёт. Возвращает ключ
 * ведомого места, когда просят другое, иначе null. Графы сличаются в
 * канонической форме @owner/slug (realms.ts): r5, nks-dev и @nks/nks-dev —
 * один граф, когда разрешены; неразрешённое имя до сюда не доходит — отказ
 * раньше (unresolvedRefusal).
 */
export function leadsOtherPlace(realm: unknown, karta: unknown, name: unknown): string | null {
  const led = ledKey();
  const prim = state.standing;
  if (!led || !prim) return null;
  const ex = extraIn(realm);
  const beside = ex?.door.key;
  const s = ex ? ex.standing : prim;
  if (!ex && otherRealm(realm, prim.realm)) return null;
  const k = normKarta(karta);
  const n = normName(name);
  // Роль: «agent» — своя по слову поверхности, что бы ни было записано; всё
  // прочее сравнивается буквально, сентинел на любой стороне проверку не
  // выключает: «me» — роль человека, не роль стояния, и с числом не совпадает;
  // мост, вставший как «me», числовой роли своим местом не считает (#5154).
  const sameKarta = k === "agent" || k === String(s.karta);
  return sameKarta && n === (s.name ?? "") ? null : (beside ?? led);
}

/**
 * Перед сличением графов: мост ведёт место, а граф вызова и граф места записаны
 * по-разному — разрешить оба в @owner/slug одним списком графов (iskron_realm list).
 */
export async function resolveAgainstLed(realm: unknown): Promise<void> {
  const prim = state.standing;
  if (!prim || !ledKey() || String(realm ?? "").trim() === prim.realm) return;
  await resolveRealms([realm, prim.realm, ...state.places.map((p) => p.realm)], async () => {
    const r = await callTool("iskron_realm", { action: "list" });
    return r.isError ? null : r.text;
  });
}

/** Графы мест, которые ведёт мост, — в канонической форме, где она известна. */
export const heldRealms = (): string[] =>
  [state.standing, ...state.places].filter((s) => !!s).map((s) => canonRealm(s?.realm));

/**
 * Имя графа, которое мост не разрешил, против графов своих мест: ни «тот же»
 * (заблокировал бы место рядом), ни «другой» (обошёл бы правило одного места,
 * #5154) — отказ вслух с просьбой о полном @owner/slug (#5838). Иначе null.
 */
export function unresolvedRefusal(realm: unknown): string | null {
  if (!ledKey() || !state.standing) return null;
  const held = [state.standing, ...state.places];
  return held.some((s) => unknownRealm(realm, s.realm))
    ? unresolvedWord(realm, heldRealms())
    : null;
}

/** Слово отказа: совет по тому, ЧЕМ просимое место отличается от ведомого. */
export function otherPlaceWord(led: string, asked: string, sameName = false): string {
  const advice =
    led === asked
      ? L(
          "ключи совпали — это то же место: повтори iskron_stand с take=true, чтобы переоткрыть его сознательно",
          "the keys match — it is the same seat: repeat iskron_stand with take=true to reopen it deliberately",
        )
      : sameName
        ? L(
            "то же имя под другой ролью (оно вывелось из того же каталога) — передай другое name, либо iskron_stand с take=true, чтобы сменить место этого моста",
            "the same name under another role (derived from the same directory) — pass another name, or iskron_stand with take=true to change this bridge's seat",
          )
        : L(
            "занять другое место вместо этого — iskron_stand с take=true (прежнее останется на доске без слуха; ненужное сними revoke)",
            "to take another seat instead of this one — iskron_stand with take=true (the former stays on the board without hearing; remove what is not needed with revoke)",
          );
  const Advice = `${advice.charAt(0).toUpperCase()}${advice.slice(1)}`;
  return L(
    `Отказано (мост): этот мост уже ведёт место ${led} — в графе место одно на мост, и место ${asked} его сняло бы с сокета молча. ` +
      `${Advice}; держать оба разом — второй мост, то есть другая сессия харнесса; место в другом графе встаёт рядом само.`,
    `Refused (bridge): this bridge already leads the seat ${led} — one seat per bridge in a graph, and the seat ${asked} would silently take it off the socket. ` +
      `${Advice}; holding both at once needs a second bridge, that is another harness session; a seat in another graph stands beside by itself.`,
  );
}

/**
 * Место в другом графе встаёт рядом только на живом канале этого моста: без
 * него (ушёл с места, место отняли) новый connect снял бы ведомое место молча.
 * Возвращает слово отказа либо null.
 */
export function besideRefusal(realm: unknown, how: "stand" | "connect"): string | null {
  const prim = state.standing;
  const led = ledKey();
  if (!led || !prim || !otherRealm(realm, prim.realm)) return null;
  if (how === "stand" && holdsChannel()) return null;
  return how === "connect"
    ? `Отказано (мост): этот мост ведёт место ${led}, а connect в другом графе открыл бы второй канал и снял бы его с сокета. Место в другом графе встаёт рядом на том же канале — iskron_stand(realm=…) или register.`
    : L(
        `Отказано (мост): этот мост ведёт место ${led}, но сокета канала у него сейчас нет (ушёл с места или место отняли) — место другого графа встать рядом не может. Сперва верни ${led}: iskron_stand его графа.`,
        `Refused (bridge): this bridge leads the seat ${led}, but has no channel socket now (it left the seat or the seat was taken) — a seat of another graph cannot stand beside. First bring back ${led}: iskron_stand for its graph.`,
      );
}

const refusal = (msg: JsonRpcMessage, text: string): JsonRpcMessage => ({
  jsonrpc: "2.0",
  id: msg.id,
  result: { isError: true, content: [{ type: "text", text }] },
});

/** Проксируемый connect/mint/register под другое место, когда мост ведёт своё, — отказ вслух вместо тихой подмены. */
export function crossPlaceRefusal(msg: JsonRpcMessage): JsonRpcMessage | null {
  if (msg?.method !== "tools/call" || msg.params?.name !== "iskron_channel") return null;
  const a = msg.params.arguments ?? {};
  if (!["connect", "mint", "register"].includes(String(a.action))) return null;
  const realm = typeof a.realm === "string" ? a.realm.trim() : "";
  const unresolved = unresolvedRefusal(realm);
  if (unresolved) return refusal(msg, unresolved);
  if (a.action !== "register") {
    const word = besideRefusal(realm, "connect");
    if (word) return refusal(msg, word);
  }
  const karta = normKarta(a.karta ?? state.standing?.karta ?? "");
  const name = normName(a.name);
  const led = leadsOtherPlace(realm, karta, name);
  if (!led) return null;
  const asked = keyOf(realm, karta, name);
  const sameName = name === (state.standing?.name ?? "");
  return refusal(msg, otherPlaceWord(led, asked, sameName));
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
    noteLocaleEcho(args, replyText(got));
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
