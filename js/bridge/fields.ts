// Поля ответов сервера рядом с прозой (граф nks-dev: #6637): structuredContent
// `{action, …}` на успехе iskron_channel и iskron_admin — ключами api, как их шлёт
// nks-mcp, — и `_meta["iskron/refusal"]` = {rule, status, data} на отказе. Мост
// читает поле, когда оно есть и сходится с формой, иначе — прежний шаблон
// прозы (board.ts, standing.ts, hook.ts), со строкой в лог. Секретов (сокет,
// статусный адрес, url хука) в полях нет — они только в тексте. Здесь — места
// (seats[]) и общее; хуки — hookfields.ts, отказ — refusal.ts.
import { asksFields } from "../shared/fields.ts";
import { log } from "./streams.ts";
import { state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

/** Место — seats[] ответа list, connect и register (у connect и register — одно). */
export interface Seat {
  seat_id?: string;
  karta_seq?: number;
  karta_name?: string;
  /** `@handle:name` */
  standing?: string;
  listening?: boolean;
  /** status места в api: `active` | `revoked` | `expired`. */
  state?: string;
  /** недоставленное */
  pending?: number;
  /** входящий адрес */
  inbound?: string;
  locale?: string;
  satellite_of?: string | null;
  realm?: string;
  doing?: string;
  /** register: true — место открыто этим вызовом, false — уже было. */
  opened?: boolean;
}

/** Место живо — только по status api; иное и отсутствующее значение живости не дают. */
export const LIVE_STATE = "active";

type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
export const is = {
  str: (v: unknown) => v === undefined || typeof v === "string",
  num: (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v)),
  bool: (v: unknown) => v === undefined || typeof v === "boolean",
  strOrNull: (v: unknown) => v === undefined || v === null || typeof v === "string",
};
const SEAT_KEYS: Record<string, (v: unknown) => boolean> = {
  seat_id: is.str,
  karta_seq: is.num,
  karta_name: is.str,
  standing: is.str,
  listening: is.bool,
  state: is.str,
  pending: is.num,
  inbound: is.str,
  locale: is.str,
  satellite_of: is.strOrNull,
  realm: is.str,
  doing: is.str,
  opened: is.bool,
};

export const structuredOf = (reply: JsonRpcMessage | null): unknown =>
  reply?.result?.structuredContent;

/** Харнес сам просил поля ответа (shared/fields.ts, #6731) — иначе они ему не отдаются. */
export const harnessAsksFields = (): boolean => asksFields(state.initParams);

/**
 * Ответ тула харнесу: без structuredContent, если поля он не просил, — Claude Code
 * при них отдаёт модели одни поля без текста (#6707). Мост их уже прочёл.
 */
export function forHarness(reply: JsonRpcMessage): JsonRpcMessage {
  const r = reply?.result;
  if (!r || !("structuredContent" in r) || harnessAsksFields()) return reply;
  const { structuredContent: _, ...rest } = r;
  return { ...reply, result: rest };
}

/**
 * Данные прошли не целиком: сервер выбросил ряды (`dropped` > 0) или не донёс
 * их вовсе (`incomplete: true`, остался {action, incomplete}). Такие поля не
 * годятся — места или хука, которого в них нет, проза бы не потеряла.
 */
export const incomplete = (sc: unknown): boolean =>
  isObj(sc) && (sc.incomplete === true || (sc.dropped !== undefined && sc.dropped !== 0));

const said = new Set<string>();
/** Поля нет, они неполны или не по форме — шаблон; одна строка в лог на ход за процесс (сторож читает доску каждый такт). */
export function fallback(what: string, sc: unknown): null {
  const why =
    sc === undefined
      ? "no field — the prose template"
      : incomplete(sc)
        ? "fields incomplete — the prose template"
        : "field off its form — the prose template";
  if (!said.has(`${what}|${why}`)) {
    said.add(`${what}|${why}`);
    log(`structuredContent ${what}: ${why}`);
  }
  return null;
}

const seat = (v: unknown): Seat | null =>
  isObj(v) && Object.entries(SEAT_KEYS).every(([k, ok]) => ok(v[k])) ? (v as Seat) : null;

/** seats[] ответа этого action — все по форме, иначе null (одно непонятое место — и весь ответ шаблоном). */
function seats(sc: unknown, action: string): Seat[] | null {
  const what = `iskron_channel ${action}`;
  if (!isObj(sc) || incomplete(sc) || sc.action !== action || !Array.isArray(sc.seats))
    return fallback(what, sc);
  const out = sc.seats.map(seat);
  return out.every((s) => s) ? (out as Seat[]) : fallback(what, sc);
}

/** Доска полями: места с ролью, адресом и слухом; folded — сколько мест доска свернула (0 — ни одного). */
export function boardField(sc: unknown): { seats: Seat[]; folded: number } | null {
  const list = seats(sc, "list");
  if (!list) return null;
  const folded = (sc as Obj).folded;
  const whole = list.every(
    (s) =>
      typeof s.karta_seq === "number" &&
      typeof s.standing === "string" &&
      s.standing.startsWith("@") &&
      typeof s.listening === "boolean",
  );
  if (!whole || !is.num(folded)) return fallback("iskron_channel list", sc);
  return { seats: list, folded: typeof folded === "number" ? folded : 0 };
}

/** Место ответа connect или register — одно, иначе null. */
export function seatField(sc: unknown, action: string): Seat | null {
  const list = seats(sc, action);
  if (!list) return null;
  return list.length === 1 ? list[0] : fallback(`iskron_channel ${action}`, sc);
}
