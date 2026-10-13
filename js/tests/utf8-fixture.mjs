import assert from "node:assert/strict";

import { MOMENT } from "../delivery/index.ts";

const schema = {
  type: "object",
  description: "Схема: ёж, Йошкар-Ола, строка\nи «кавычки».",
  properties: {
    text: { type: "string", description: "Текст на русском", enum: ["ёж", "Язык"] },
    nested: { type: "array", items: { type: "object", properties: { имя: { type: "string" } } } },
  },
  required: ["text"],
};
export const tools = ["iskron_orient", "iskron_add_vimarsha", "iskron_batch"].map((name) => ({
  name,
  description: `Описание ${name}: кириллица ёж ЙЯ.`,
  inputSchema: schema,
  outputSchema: { type: "object", description: "Ответ по-русски" },
}));
tools.push({
  name: "iskron_channel",
  description: "Живой канал: кириллица ёж ЙЯ.",
  inputSchema: {
    ...schema,
    properties: {
      ...schema.properties,
      action: {
        type: "string",
        description: "Действие. Одно из: list | mint | connect | sessions | register | revoke",
        enum: ["list", "mint", "connect", "sessions", "register", "revoke"],
      },
      ttl_seconds: { type: "number", description: "Срок" },
      mute_siblings: { type: "boolean", description: "Соседи" },
    },
    required: ["text", "ttl_seconds"],
  },
});
export const callResult = {
  content: [{ type: "text", text: "Ответ: кириллица ёж ЙЯ\n«не экранирован»" }],
  structuredContent: { имя: "Ёж", nested: { текст: "Русский язык", строки: ["ЙЯ", "ещё"] } },
};

// Byte assertion deliberately precedes JSON.parse: parsing would conceal \u04xx.
export function rawUtf8(raw, literals) {
  assert.ok(Buffer.isBuffer(raw));
  assert.equal(raw.includes(Buffer.from("\\u04", "ascii")), false, "no Cyrillic JSON escapes");
  for (const literal of literals)
    assert.ok(raw.includes(Buffer.from(literal, "utf8")), `raw UTF-8 bytes: ${literal}`);
}

export function listedTools(raw, fields, selected = tools.map((t) => t.name)) {
  rawUtf8(raw, ["кириллица ёж ЙЯ", "Текст на русском", "Схема:"]);
  const received = JSON.parse(raw.toString("utf8")).result.tools;
  // Exhaustive exceptions: own stand tool; writing moment; channel status/leave
  // prefixes; channel place moves/fields narrowed; outputSchema without fields;
  // --tools omits iskron_batch in the satellite fixture; stand is always appended.
  assert.deepEqual(
    received.map((t) => t.name),
    [...tools.filter((t) => selected.includes(t.name)).map((t) => t.name), "iskron_stand"],
  );
  const stand = received.at(-1);
  assert.equal(typeof stand.description, "string");
  assert.equal(stand.inputSchema.type, "object");
  for (const original of tools.filter((t) => selected.includes(t.name))) {
    const expected = structuredClone(original);
    if (/^iskron_(add_[a-z_]+|batch)$/.test(original.name))
      expected.description = `${MOMENT.ru.moment()}\n\n${original.description}`;
    if (original.name === "iskron_channel") {
      expected.description = `${MOMENT.ru.status()}\n${MOMENT.ru.leave()}\n\n${original.description}`;
      delete expected.inputSchema.properties.ttl_seconds;
      delete expected.inputSchema.properties.mute_siblings;
      expected.inputSchema.required = ["text"];
      expected.inputSchema.properties.action.enum = ["list", "register", "revoke"];
      expected.inputSchema.properties.action.description =
        "Действие. Одно из: list | register | revoke";
    }
    if (!fields) delete expected.outputSchema;
    const actual = received.find((t) => t.name === original.name);
    // Full serialized objects: no unexpected field, description or schema change.
    assert.deepEqual(Buffer.from(JSON.stringify(actual)), Buffer.from(JSON.stringify(expected)));
  }
}
