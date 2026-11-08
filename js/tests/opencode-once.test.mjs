// Behavioural probe for the case frame text the OpenCode plugin puts into a session (graph
// @nks/nks-dev, node #9654): every fact once in one prompt — the case named only in its count,
// its records under it by [entry]; a seat by one address. One prompt per kind of the node's
// «answered when»: word, ask, ack, answer, invite, closing, closed. Fake bridge, stand-in context
// (opencode-kit.mjs); ISKRON_OPENCODE_PLUGIN aims it at any copy, so it shows red before a fix.
import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BATCH_MS, delay, plugin, SANDBOX, until } from "./opencode-kit.mjs";
import { ack, answer, ask, closing, ME, ME_ID, progress, roomFrame } from "./room-frames.mjs";

const FAKE_BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "fake-bridge.mjs");
const LABEL = "№7 «Стенд»";
const event = (kind, extra) => JSON.stringify({ kind, ...extra }) + "\n";
const times = (text, value) => text.split(value).length - 1;
const once = (text, ...values) => {
  for (const v of values) assert.equal(times(text, v), 1, `«${v}» once in:\n${text}`);
};

async function seated(name, s) {
  const log = join(SANDBOX, `${name}.log`);
  const events = join(SANDBOX, `${name}.events`);
  const reply = join(SANDBOX, `${name}.reply`);
  for (const f of [log, events, reply]) writeFileSync(f, "");
  const rec = await plugin(
    { ISKRON_BRIDGE_PATH: FAKE_BRIDGE, FB_LOG: log, FB_REPLY: reply, FB_EVENTS: events },
    { sessions: [{ id: s, location: { directory: "/work/once" } }] },
  );
  await until(() => rec.tools().size === 3, "the server's tools", 8000);
  await rec.call("iskron_channel", { action: "connect" }, s);
  const pid = Number(readFileSync(log, "utf8").trim().split("\n")[0].split(/\s+/)[1]);
  const lay = (...frames) =>
    appendFileSync(
      `${events}.${pid}`,
      frames.map((frame) => event("frame", { frame, raw: JSON.stringify(frame) })).join(""),
    );
  /** Lay the frames, wait for exactly one new prompt and give its text. */
  const prompt = async (...frames) => {
    const n = rec.prompts.length;
    lay(...frames);
    await until(() => rec.prompts.length > n, `a prompt for ${frames.map((f) => f.entry_id)}`);
    await delay(BATCH_MS * 3);
    assert.equal(rec.prompts.length, n + 1, "one prompt");
    return rec.prompts[n].text;
  };
  /** Lay a count-only record: it rides the next prompt, none of its own. */
  const ride = async (frame) => {
    const n = rec.prompts.length;
    lay(frame);
    await delay(BATCH_MS * 4);
    assert.equal(rec.prompts.length, n, "a count prompts nothing");
  };
  return { rec, prompt, ride };
}

const word = roomFrame("said", {
  entry_id: 201,
  stack: "defer",
  envelope: { addressee: ME },
  body: "ТЕЛО-СЛОВА-201",
});
// A record to the seat that piles (its kind's rule is batch), with a count riding beside it.
for (const [kind, frame, facts] of [
  ["word", word, ["[201]", "ТЕЛО-СЛОВА-201", "@aleksei:probe"]],
  ["ask", ask(202), ["[202]", "Выкатывать сегодня?", ME, "Поставщик плитки"]],
  ["ack", ack(203, 150, ME), ["[203]", "[150]", "выкатываю после обеда", "@aleksei:probe"]],
])
  test(`a pile of the ${kind} to the seat and a count names the case once, in its count`, async () => {
    const { rec, prompt } = await seated(`once-${kind}`, `s-${kind}`);
    try {
      const text = await prompt(progress(44, "k-44"), frame);
      once(text, LABEL, ...facts);
      assert.match(text, /^№7 «Стенд»: записей 2, тебе 1; /, text);
      assert.match(text.split("\n")[1], /^\[20[123]\] /, text);
    } finally {
      await rec.stop();
    }
  });

test("a pile of several records to the seat puts each under the one count", async () => {
  const { rec, prompt } = await seated("once-pile", "s-pile");
  try {
    const text = await prompt(progress(44, "k-44"), word, ask(202), ack(203, 150, ME));
    once(text, LABEL, "[201]", "[202]", "[203]");
    assert.match(text, /^№7 «Стенд»: записей 4, тебе 3; /, text);
    for (const line of text.split("\n").slice(1)) assert.match(line, /^\[20[123]\] /, text);
  } finally {
    await rec.stop();
  }
});

test("a person's answer alone is one short line, every fact once", async () => {
  const { rec, prompt } = await seated("once-answer", "s-answer");
  try {
    const text = await prompt(answer(204, 202));
    assert.equal(text.split("\n").length, 1, text);
    once(text, LABEL, "[204]", "[202]", "после обеда", "@dmitry:phone");
  } finally {
    await rec.stop();
  }
});

test("an invite to the seat by its name and address names the seat once", async () => {
  const { rec, prompt } = await seated("once-invite-alone", "s-invite-alone");
  try {
    const text = await prompt(
      roomFrame("invite", {
        entry_id: 205,
        key: `invite:${ME_ID}`,
        fields: { standing: { id: ME_ID, standing: ME, name: "proba" } },
      }),
    );
    once(text, LABEL, "[205]", ME, "@aleksei:probe");
    assert.doesNotMatch(text, /proba \(/, text);
  } finally {
    await rec.stop();
  }
});

// A record that interrupts (invite to the seat, closing, closed) after a count that rode.
for (const [kind, frame, facts] of [
  [
    "invite",
    roomFrame("invite", {
      entry_id: 205,
      key: `invite:${ME_ID}`,
      fields: { standing: { id: ME_ID, standing: ME, name: "proba" } },
    }),
    ["[205]", ME, "@aleksei:probe"],
  ],
  ["closing", closing(), ["[50]", "@aleksei:probe", "сделано, см. 41"]],
  [
    "closed",
    roomFrame("closed", { entry_id: 207, status: "closed", fields: { reason: "consensus" } }),
    ["[207]", "consensus"],
  ],
])
  test(`the ${kind} after a riding count names the case once, in its count`, async () => {
    const { rec, prompt, ride } = await seated(`once-${kind}`, `s-${kind}`);
    try {
      await ride(progress(45, "k-45"));
      const text = await prompt(frame);
      once(text, LABEL, ...facts);
      assert.match(text, /^№7 «Стенд»: записей 2, тебе 1; /, text);
      assert.match(text.split("\n")[1], /^\[(205|50|207)\] /, text);
    } finally {
      await rec.stop();
    }
  });
