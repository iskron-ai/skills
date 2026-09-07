// Схема аргументов тула для OpenCode: из JSON Schema моста — в zod-поля.
//
// OpenCode берёт аргументы плагинного тула только zod-формой (`tool.schema`,
// см. @opencode-ai/plugin), а мост отдаёт JSON Schema сервера. Сводится верхний
// уровень: тип, enum, описание, обязательность — то, что видит модель и что
// валидирует харнесс. Вложенные формы (объекты, массивы, anyOf) идут как есть,
// `any`: их точность хранит описание тула, а не схема, и сервер проверяет сам.
import { tool } from "@opencode-ai/plugin";

type Z = typeof tool.schema;

/* eslint-disable @typescript-eslint/no-explicit-any -- JSON Schema приходит без типа */

function one(p: any, z: Z): any {
  if (
    Array.isArray(p?.enum) &&
    p.enum.length &&
    p.enum.every((e: unknown) => typeof e === "string")
  )
    return z.enum(p.enum as [string, ...string[]]);
  const types: unknown[] = Array.isArray(p?.type) ? p.type : [p?.type];
  const t = types.find((x) => x !== "null");
  let s: any;
  switch (t) {
    case "string":
      s = z.string();
      break;
    case "number":
    case "integer":
      s = z.number();
      break;
    case "boolean":
      s = z.boolean();
      break;
    case "array":
      s = z.array(z.any());
      break;
    case "object":
      s = z.record(z.string(), z.any());
      break;
    default:
      s = z.any();
  }
  return types.includes("null") ? s.nullable() : s;
}

/** Поля zod для `tool({ args })` из JSON Schema объекта параметров. */
export function argsFrom(inputSchema: any, z: Z = tool.schema): Record<string, any> {
  const props: Record<string, any> =
    inputSchema && typeof inputSchema.properties === "object" ? inputSchema.properties : {};
  const required = new Set<string>(
    Array.isArray(inputSchema?.required) ? inputSchema.required : [],
  );
  const out: Record<string, any> = {};
  for (const [key, p] of Object.entries(props)) {
    let s = one(p, z);
    if (typeof p?.description === "string" && p.description) s = s.describe(p.description);
    if (!required.has(key)) s = s.optional();
    out[key] = s;
  }
  return out;
}

/* eslint-enable @typescript-eslint/no-explicit-any */
