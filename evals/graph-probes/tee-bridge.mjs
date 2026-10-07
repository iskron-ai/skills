#!/usr/bin/env node
// Обёртка моста для прогона проб: плагин зовёт её вместо моста, она поднимает мост
// и пишет каждую строку JSON-RPC между ними целиком в журнал (README, «Протокол прогона», п. 5).
// ISKRON_PROBE_BRIDGE — настоящий мост, ISKRON_PROBE_LOG — журнал прогона (NDJSON).
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const bridge = process.env.ISKRON_PROBE_BRIDGE;
const log = process.env.ISKRON_PROBE_LOG;
if (!bridge || !log) {
  process.stderr.write(
    "tee-bridge: нужны ISKRON_PROBE_BRIDGE и ISKRON_PROBE_LOG\n",
  );
  process.exit(2);
}

const child = spawn(process.execPath, [bridge, ...process.argv.slice(2)], {
  stdio: ["pipe", "pipe", "inherit"],
});

function tee(dir) {
  let buf = "";
  return (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim())
        appendFileSync(
          log,
          JSON.stringify({
            t: new Date().toISOString(),
            pid: process.pid,
            dir,
            line,
          }) + "\n",
        );
    }
  };
}

const toBridge = tee("plugin→bridge");
const fromBridge = tee("bridge→plugin");
process.stdin.setEncoding("utf8");
child.stdout.setEncoding("utf8");
process.stdin.on("data", (c) => {
  toBridge(c);
  child.stdin.write(c);
});
process.stdin.on("end", () => child.stdin.end());
child.stdout.on("data", (c) => {
  fromBridge(c);
  process.stdout.write(c);
});
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"])
  process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
