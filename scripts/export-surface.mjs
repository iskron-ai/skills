#!/usr/bin/env node
// Regenerate fixtures/surface.json — the committed snapshot of the live nks-mcp
// tool surface that `make check-surface` lints the corpus against.
//
// Run when the server surface changes (needs network + an authorized grant):
//   node scripts/export-surface.mjs [server-url]
//
// Speaks to the server through the delivery's own bridge (bridge-stdio.mjs),
// so auth, refresh and liveness are the bridge's problem, not this script's.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { openBridge, root } from "./bridge-stdio.mjs";

const b = openBridge(process.argv[2] ? [process.argv[2]] : []);
const init = await b.initialize("export-surface");

const tools = [];
let cursor;
do {
  const res = await b.request("tools/list", cursor ? { cursor } : {});
  if (res.error) throw new Error(`tools/list failed: ${JSON.stringify(res.error)}`);
  tools.push(...res.result.tools);
  cursor = res.result.nextCursor;
} while (cursor);

// Merge every enum-carrying property across all tool input schemas: one
// vocabulary per property name (union — a property may legitimately differ in
// subsets per tool; the lint asks membership, not exactness).
const enums = {};
const walk = (schema, name) => {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema.enum) && name) {
    enums[name] = [...new Set([...(enums[name] || []), ...schema.enum])].sort();
  }
  for (const [k, v] of Object.entries(schema.properties || {})) walk(v, k);
  if (schema.items) walk(schema.items, name);
  for (const sub of ["anyOf", "oneOf", "allOf"]) (schema[sub] || []).forEach((v) => walk(v, name));
};
for (const t of tools) walk(t.inputSchema, null);

// Канонический идентификатор ресурса — строка `resource` из документа
// protected-resource, и она НЕ обязана совпадать с тем, как адрес принято
// писать: сервер отдаёт её без хвостовой косой, а запись MCP пишут с косой по
// привычке. Наивное сравнение строк на этом байте и расходится, а отказ
// приходит немым — клиент говорит «сервер недоступен», не «идентификаторы
// разошлись». Поэтому строка снимается наблюдением и кладётся в снимок: гейт
// сверяет с ней отгружаемую запись, и «кто-то написал с косой» ловится до
// мержа, а не живым отказом у пользователя. Документ публичный, грант не нужен.
let resourceId = null;
try {
  const u = new URL(process.argv[2] || "https://mcp.iskron.ru/");
  const prm = await fetch(`${u.origin}/.well-known/oauth-protected-resource${u.pathname === "/" ? "" : u.pathname}`,
    { signal: AbortSignal.timeout(15_000) }).then((r) => (r.ok ? r.json() : null));
  resourceId = prm?.resource ?? null;
} catch (e) {
  console.error(`# не удалось снять канонический идентификатор ресурса: ${e.message}`);
}

// Аргументы, которые объявляет схема каждого тула. Сервер собирает тело вызова
// из этого списка и молча роняет прочее — фейк NKS в пробах (js/tests/fake-nks.mjs)
// роняет по нему же, чтобы проба не зеленела на поверхности, которой нет.
// Тулы самого моста (iskron_stand) сюда тоже попадают — снимок видит поверхность
// глазами агента; фейк их не обслуживает, и строка ему не мешает.
const declared = Object.fromEntries(
  tools
    .map((t) => [t.name, Object.keys(t.inputSchema?.properties ?? {}).sort()])
    .sort(([a], [b]) => a.localeCompare(b)),
);

// Комбинаторы верхнего уровня схемы каждого тула (граф nks-dev: #6500): anyOf,
// oneOf или allOf наверху у одного тула — и Messages API отвергает весь список.
// Мост их сливает, но помечает слитое в `_meta` тула — снимок видит изъян
// сервера и сквозь мост; `make check-surface` роняет гейт с именем тула.
const TOP_COMBINATORS = ["anyOf", "oneOf", "allOf"];
const combinators = Object.fromEntries(
  tools
    .map((t) => {
      const raw = TOP_COMBINATORS.filter((k) => Array.isArray(t.inputSchema?.[k]));
      const flattened = t._meta?.["ru.iskron/flattened"] ?? [];
      return [t.name, [...new Set([...raw, ...flattened])].sort()];
    })
    .sort(([a], [b]) => a.localeCompare(b)),
);

const surface = {
  server: init.result?.serverInfo ?? null,
  protocolVersion: init.result?.protocolVersion ?? null,
  resource: resourceId,
  tools: tools.map((t) => t.name).sort(),
  enums,
  args: declared,
  combinators,
};
const out = join(root, "fixtures/surface.json");
writeFileSync(out, JSON.stringify(surface, null, 2) + "\n");
console.log(`wrote ${out}: ${surface.tools.length} tools, ${Object.keys(enums).length} enum vocabularies`);
b.close();
