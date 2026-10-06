// Хуки роли полями (граф nks-dev: #6637): webhooks[] ответа iskron_admin
// list_webhooks и user_webhooks ключами api. url хука и секрет в поля не кладутся.
import { fallback, is, isObj } from "./fields.ts";

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
