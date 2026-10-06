// Поля ответов сервера рядом с прозой (граф nks-dev: #6637): structuredContent
// `{action, …}` на успехе iskron_channel и iskron_admin — ключами api, как их шлёт
// nks-mcp, — и `_meta["iskron/refusal"]` = {rule, status, data} на отказе. Мост
// читает поле, когда оно есть и сходится с формой ниже, иначе — прежний шаблон
// прозы (board.ts, standing.ts, hook.ts), со строкой в лог. Секретов (сокет,
// статусный адрес, url хука) в полях нет — они только в тексте.
import { log } from "./streams.ts";
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

/** Хук роли — webhooks[] ответа list_webhooks и user_webhooks. */
export interface Hook {
  id?: number;
  kind?: string;
  target_karta_seq?: number;
  active: boolean;
  reaches?: { standing?: string | null; you?: boolean }[];
  /** будит ли хук место этой сессии — считает api */
  reaches_you?: boolean;
}

/** Отказ api как данные: правило ProblemDetail, статус и его data без секретов. */
export interface Refusal {
  rule?: string;
  status?: number;
  data?: Record<string, unknown>;
}

/** Место живо — только по status api; иное и отсутствующее значение живости не дают. */
export const LIVE_STATE = "active";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const is = {
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

/** `_meta["iskron/refusal"]` отказа по форме, иначе null. */
export function refusalOf(reply: JsonRpcMessage | null): Refusal | null {
  const r: unknown = reply?.result?._meta?.["iskron/refusal"];
  if (!isObj(r) || !is.str(r.rule) || !is.num(r.status)) return null;
  return {
    ...(typeof r.rule === "string" ? { rule: r.rule } : {}),
    ...(typeof r.status === "number" ? { status: r.status } : {}),
    ...(isObj(r.data) ? { data: r.data } : {}),
  };
}

const said = new Set<string>();
/** Поля нет или оно не по форме — шаблон; одна строка в лог на ход за процесс (сторож читает доску каждый такт). */
function fallback(what: string, sc: unknown): null {
  const why =
    sc === undefined ? "no field — the prose template" : "field off its form — the prose template";
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
  if (!isObj(sc) || sc.action !== action || !Array.isArray(sc.seats)) return fallback(what, sc);
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

const hook = (v: unknown): Hook | null => {
  if (!isObj(v) || typeof v.active !== "boolean") return null;
  if (!is.num(v.id) || !is.str(v.kind) || !is.num(v.target_karta_seq) || !is.bool(v.reaches_you))
    return null;
  const reaches = v.reaches;
  if (reaches !== undefined) {
    if (!Array.isArray(reaches)) return null;
    if (!reaches.every((r) => isObj(r) && is.strOrNull(r.standing) && is.bool(r.you))) return null;
  }
  // «Будит ли меня» — только словом api: без reaches_you и reaches судить нечем.
  if (v.reaches_you === undefined && reaches === undefined) return null;
  return v as unknown as Hook;
};

/** webhooks[] списка хуков — все по форме, иначе null. */
export function hooksField(sc: unknown, action = "list_webhooks"): Hook[] | null {
  const what = `iskron_admin ${action}`;
  if (!isObj(sc) || sc.action !== action || !Array.isArray(sc.webhooks)) return fallback(what, sc);
  const out = sc.webhooks.map(hook);
  return out.every((h) => h) ? (out as Hook[]) : fallback(what, sc);
}

/** Будит ли хук место этой сессии — reaches_you, иначе reaches[].you. */
export const reachesYou = (h: Hook): boolean =>
  h.reaches_you ?? (h.reaches ?? []).some((r) => r.you === true);
