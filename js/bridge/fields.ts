// Поля structuredContent ответов сервера (граф nks-dev: #6637; ключи согласованы
// с держателем nks-mcp в деле №186). Сервер кладёт их рядом с прозой и описывает
// формой в outputSchema тула; мост читает поле, когда оно есть и сходится с
// формой ниже, иначе — прежний шаблон прозы (board.ts, standing.ts), со строкой
// в лог. Секреты (сокет, статусный адрес) в поля не кладутся — они только в тексте.
import { log } from "./streams.ts";
import { type JsonRpcMessage } from "./types.ts";

/** Место доски — iskron_channel list, places[]. */
export interface PlaceField {
  id: string;
  karta: number;
  name: string;
  /** `@handle:name` */
  address: string;
  inbox: string | null;
  listening: boolean;
  undelivered: number;
  /** Отдельно от listening, только если сервер их различает. */
  alive?: boolean;
}

/** Ответ register/connect: место, на которое легла сессия. */
export interface SeatField {
  standing_id: string;
  name: string;
  outcome: string;
  locale: string | null;
  inbox: string | null;
}

/** Хук роли — iskron_admin list_webhooks, webhooks[]. */
export interface HookField {
  id: number;
  karta: number;
  active: boolean;
  target: { kind: string; standing_id?: string; url?: string };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const num = (v: unknown): boolean =>
  (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && /^\d+$/.test(v));
const strOrNull = (v: unknown): v is string | null | undefined =>
  v == null || typeof v === "string";

export const structuredOf = (reply: JsonRpcMessage | null): unknown =>
  reply?.result?.structuredContent;

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

function place(v: unknown): PlaceField | null {
  if (!isObj(v)) return null;
  const { id, karta, name, address, inbox, listening, undelivered, alive } = v;
  if (!str(id) || !num(karta) || typeof name !== "string" || !str(address)) return null;
  if (!address.startsWith("@") || typeof listening !== "boolean" || !strOrNull(inbox)) return null;
  if (undelivered != null && !num(undelivered)) return null;
  if (alive != null && typeof alive !== "boolean") return null;
  return {
    id,
    karta: Number(karta),
    name,
    address,
    inbox: inbox ?? null,
    listening,
    undelivered: undelivered == null ? 0 : Number(undelivered),
    ...(typeof alive === "boolean" ? { alive } : {}),
  };
}

/** places[] доски — все места по форме, иначе null (одно непонятое место — и вся доска шаблоном). */
export function placesField(sc: unknown): PlaceField[] | null {
  const list = isObj(sc) ? sc.places : undefined;
  if (!Array.isArray(list)) return fallback("iskron_channel list", sc);
  const out = list.map(place);
  return out.every((p) => p) ? (out as PlaceField[]) : fallback("iskron_channel list", sc);
}

/** Поля register/connect по форме, иначе null. */
export function seatField(sc: unknown, action: string): SeatField | null {
  if (!isObj(sc)) return fallback(`iskron_channel ${action}`, sc);
  const { standing_id, name, outcome, locale, inbox } = sc;
  if (!str(standing_id) || typeof name !== "string" || typeof outcome !== "string")
    return fallback(`iskron_channel ${action}`, sc);
  if (!strOrNull(locale) || !strOrNull(inbox)) return fallback(`iskron_channel ${action}`, sc);
  return { standing_id, name, outcome, locale: locale ?? null, inbox: inbox ?? null };
}

function hook(v: unknown): HookField | null {
  if (!isObj(v)) return null;
  const { id, karta, active, target } = v;
  if (!num(id) || !num(karta) || typeof active !== "boolean" || !isObj(target)) return null;
  const { kind, standing_id, url } = target;
  if (!str(kind) || !strOrNull(standing_id) || !strOrNull(url)) return null;
  return {
    id: Number(id),
    karta: Number(karta),
    active,
    target: {
      kind,
      ...(standing_id ? { standing_id } : {}),
      ...(url ? { url } : {}),
    },
  };
}

/** webhooks[] списка хуков — все по форме, иначе null. */
export function hooksField(sc: unknown): HookField[] | null {
  const list = isObj(sc) ? sc.webhooks : undefined;
  if (!Array.isArray(list)) return fallback("iskron_admin list_webhooks", sc);
  const out = list.map(hook);
  return out.every((h) => h) ? (out as HookField[]) : fallback("iskron_admin list_webhooks", sc);
}
