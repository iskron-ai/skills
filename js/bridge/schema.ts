// Схема тула без комбинаторов на верхнем уровне (граф nks-dev: вимарша #6500).
//
// Messages API Anthropic отвергает запрос целиком, если хоть у одного тула
// input_schema несёт наверху anyOf, oneOf или allOf: сессия харнеса не
// стартует вовсе. Мост сливает ветви в один объект — свойства объединены,
// обязательным остаётся общее, — а условие «одно из» дописывает фразой в
// описание тула. Сервер по-прежнему проверяет вызов сам. Внутренность
// свойств не трогается: нестандартные ключи сервера едут как есть.
// Что мост слил, стоит в `_meta` тула — снимок поверхности (make surface)
// видит изъян сервера и сквозь мост.

type Schema = Record<string, unknown>;
type Tool = { name?: unknown; description?: unknown; inputSchema?: unknown; _meta?: unknown };

export const COMBINATORS = ["anyOf", "oneOf", "allOf"] as const;
/** Ключ `_meta` тула: какие комбинаторы верхнего уровня мост слил. */
export const FLATTENED_META = "ru.iskron/flattened";

const isObj = (v: unknown): v is Schema => !!v && typeof v === "object" && !Array.isArray(v);
const reqOf = (s: Schema): string[] =>
  Array.isArray(s.required) ? s.required.filter((x): x is string => typeof x === "string") : [];

/** Слить комбинаторы верхнего уровня схемы тула. Идемпотентно: слитой схеме делать нечего. */
export function flattenTopCombinators(tool: Tool): void {
  const schema = tool?.inputSchema;
  if (!isObj(schema)) return;
  const found = COMBINATORS.filter((k) => Array.isArray(schema[k]));
  if (!found.length) return;

  const out: Schema = { ...schema, type: "object" };
  const properties: Schema = isObj(schema.properties) ? { ...schema.properties } : {};
  const required = new Set(reqOf(schema));
  const phrases: string[] = [];
  for (const k of found) {
    delete out[k];
    const branches = (schema[k] as unknown[]).filter(isObj);
    for (const b of branches)
      if (isObj(b.properties))
        for (const [p, v] of Object.entries(b.properties))
          if (!(p in properties)) properties[p] = v;
    if (k === "allOf") {
      // Все ветви держатся разом: обязательное каждой — обязательно.
      for (const b of branches) for (const r of reqOf(b)) required.add(r);
      continue;
    }
    // Одна из ветвей: обязательно только общее всем, прочее — группы на выбор.
    const common = branches.length
      ? reqOf(branches[0]).filter((r) => branches.every((b) => reqOf(b).includes(r)))
      : [];
    for (const r of common) required.add(r);
    const groups = branches.map((b) => {
      const own = reqOf(b).filter((r) => !common.includes(r));
      return own.length ? own.join("+") : "ничего сверх общего";
    });
    phrases.push(
      `[мост] Одно из (${k}): кроме обязательных полей схемы нужна одна из групп — ${groups.join(" | ")}; схему слил мост, вызов проверяет сервер.`,
    );
  }
  out.properties = properties;
  if (required.size) out.required = [...required];
  else delete out.required;
  tool.inputSchema = out;

  const meta = isObj(tool._meta) ? tool._meta : {};
  tool._meta = { ...meta, [FLATTENED_META]: found };
  const d = typeof tool.description === "string" ? tool.description : "";
  const add = phrases.filter((p) => !d.includes(p));
  if (add.length) tool.description = [d, ...add].filter(Boolean).join("\n\n");
}
