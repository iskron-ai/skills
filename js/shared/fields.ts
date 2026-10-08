// Поля ответа по запросу (граф nks-dev: #6637, решение #6731): сервер отдаёт
// structuredContent и outputSchema только MCP-сессии клиента, объявившего
// capabilities.experimental["iskron/structured"] в initialize. Харнес, который
// получил поля, может передать модели одни поля без текста (Claude Code, #6707);
// мост просит их для собственного разбора всегда, а харнесу отдаёт, только если
// просил он сам. Плагин OpenCode (поля — когда текста нет, bridge-client.ts
// resultToContent) и расширение pi (details тула) объявляют ключ мосту.

import { SERVER_PROTOCOL } from "../delivery/index.ts";

/** Ключ capability полей ответа. */
export const FIELDS_CAPABILITY = SERVER_PROTOCOL.fields;

/** capabilities клиента моста, которому поля отдаются (плагин OpenCode, расширение pi). */
export const FIELDS_CAPABILITIES = { experimental: { [FIELDS_CAPABILITY]: {} } };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};

/** Просил ли поля сам клиент — по params его initialize. */
export const asksFields = (initParams: unknown): boolean =>
  FIELDS_CAPABILITY in obj(obj(obj(initParams).capabilities).experimental);

/** params initialize с объявленным ключом; объявленное клиентом значение не трогается. */
export function withFieldsAsked(initParams: unknown): Obj {
  const p = obj(initParams);
  const caps = obj(p.capabilities);
  const exp = obj(caps.experimental);
  if (FIELDS_CAPABILITY in exp) return p;
  return { ...p, capabilities: { ...caps, experimental: { ...exp, [FIELDS_CAPABILITY]: {} } } };
}
