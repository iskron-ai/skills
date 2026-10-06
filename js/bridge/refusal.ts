// Отказ api как данные (граф nks-dev: #6637): `_meta["iskron/refusal"]` =
// {rule, status, data} на отказе iskron_channel и iskron_admin — правило
// ProblemDetail, его статус и data без секретов. Нет его — потребитель судит прозой.
import { is, isObj } from "./fields.ts";
import { type JsonRpcMessage } from "./types.ts";

/** Отказ api как данные: правило ProblemDetail, статус и его data без секретов. */
export interface Refusal {
  rule?: string;
  status?: number;
  data?: Record<string, unknown>;
}

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

/**
 * register отказан гонкой открытия места: 409 без rule («opened concurrently;
 * register again»). Rule здесь — из errors[0] ProblemDetail (корневой rule nks-mcp
 * не читает): 409 регистрации с правилом только в корне придёт сюда без rule и
 * тоже получит повтор — один, отказ которого вернётся как есть.
 */
export const openedConcurrently = (reply: JsonRpcMessage | null): boolean => {
  const r = reply?.result?.isError ? refusalOf(reply) : null;
  return !!r && !r.rule && r.status === 409;
};
