#!/usr/bin/env node
// Regenerate fixtures/widgets.json — the committed snapshot of the widget
// contract in the graph: the contract node and its contains-children, one node
// per widget (graph nks-dev: #6146, #6190). `make check-widgets` renders
// skills/widgets/SKILL.md from it and fails when the committed file differs.
//
// Run when the widget nodes change (needs network + an authorized grant):
//   node scripts/export-widgets.mjs [server-url]
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { openBridge, root } from "./bridge-stdio.mjs";

const REALM = "r5";
const CONTRACT = "6146";

const b = openBridge(process.argv[2] ? [process.argv[2]] : []);
await b.initialize("export-surface");

const look = (id, raw = false) => b.tool("iskron_look", { realm: REALM, node_id: id, raw });
const nameOf = (card) => /^(.*?) \(#\d+,/.exec(card.split("\n")[0])?.[1]?.trim() ?? "";

const card = await look(CONTRACT);
// Children under the «→ contains:» heading of the card, one per line until the next heading.
const block = /→ contains:\n((?:\s{4}.*\n?)+)/.exec(card)?.[1] ?? "";
const children = [...block.matchAll(/\(#(\d+)\)/g)].map((m) => m[1]);
if (!children.length) throw new Error(`no contains-children under #${CONTRACT}:\n${card}`);

const widgets = [];
for (const seq of children.sort((a, c) => Number(a) - Number(c))) {
  widgets.push({ seq: Number(seq), name: nameOf(await look(seq)), body: await look(seq, true) });
}
const snapshot = {
  realm: REALM,
  contract: { seq: Number(CONTRACT), name: nameOf(card), body: await look(CONTRACT, true) },
  widgets,
};
const out = join(root, "fixtures/widgets.json");
writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n");
console.log(`wrote ${out}: ${widgets.length} widgets under #${CONTRACT}`);
b.close();
