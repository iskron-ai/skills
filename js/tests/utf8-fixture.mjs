import assert from "node:assert/strict";

export const wireModes = [false, true].flatMap((fields) =>
  [false, true].map((sse) => ({ fields, sse })),
);

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
  inputSchema: schema,
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

function strings(value) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...strings(nested)]);
}

export function listedTools(raw, fields, selected = tools.map((t) => t.name)) {
  rawUtf8(raw, ["кириллица ёж ЙЯ", "Текст на русском", "Схема:"]);
  const received = JSON.parse(raw.toString("utf8")).result.tools;
  for (const original of tools.filter((t) => selected.includes(t.name))) {
    const actual = received.find((t) => t.name === original.name);
    assert.ok(actual, `server tool: ${original.name}`);
    assert.ok(actual.description.includes(original.description), original.name);
    for (const field of fields ? ["inputSchema", "outputSchema"] : ["inputSchema"]) {
      const preserved = strings(actual[field]);
      for (const literal of strings(original[field]).filter((s) => /[\u0400-\u04ff]/u.test(s)))
        assert.ok(preserved.includes(literal), `${original.name}.${field}: ${literal}`);
    }
  }
}
