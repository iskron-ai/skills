#!/usr/bin/env node
// Offline preparation entry point. Deliberately no live/run command.
import { writeFileSync } from "node:fs";
import { loadPackage } from "./protocol.mjs";

const command = process.argv[2];
if (command !== "inspect" && command !== "freeze") throw new Error("use inspect | freeze FILE (offline only)");
if (process.argv.length !== (command === "freeze" ? 4 : 3)) throw new Error("unexpected arguments");
const p = loadPackage();
const summary = { schema: 1, sha256: p.sha256, files: p.files, limits: p.limits, arms: p.arms,
  decisions: p.oracle.decisions.length, modelCalls: 0, liveReady: false,
  unresolved: ["LAB modes and negative samples", "reader case denial plus no bypass", "real-model cost boundary",
    "script/seed adapter and raw server+bridge ledger", "final integrated guard+score freeze", "parent launch permission"] };
if (command === "freeze") {
  // Exclusive creation: never silently replace a prior commitment.
  writeFileSync(process.argv[3], JSON.stringify(summary, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
