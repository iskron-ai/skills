// Место роли без имени (граф nks-dev: #6748): прогон приёмки оставил на боевой
// доске место «@handle» — пустое имя пришло мимо выведения. Мост не занимает
// такого места ни одним путём: сырой connect, mint, register без name или с
// пустым — отказ вслух, на сервер не уходит; iskron_stand без имени и с name=""
// в изолированном доме встаёт на выведенное имя, не на пустое. Полный мост и
// тонкий через демон машины — один выход к серверу.
//
// ISKRON_BRIDGE_PATH=<старый iskron.mjs> — проба краснеет: сырой ход без имени
// уходит на сервер.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const FILE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const PAT = "nks_pat_unnamed";
const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "unnamed-probe", version: "0" },
};

function startBridge(url, home, env) {
  const proc = spawn(
    NODE,
    [FILE, url, "--no-browser", "--auth-dir", join(home, ".iskron-bridge")],
    {
      cwd: home,
      env: {
        ...process.env,
        HOME: home,
        ISKRON_BRIDGE_NO_BROWSER: "1",
        ISKRON_BRIDGE_TOKEN: PAT,
        ISKRON_BRIDGE_NO_UPDATE: "1",
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const waiters = new Map();
  let out = "";
  proc.stdout.on("data", (c) => {
    out += c;
    let nl;
    while ((nl = out.indexOf("\n")) >= 0) {
      const line = out.slice(0, nl).trim();
      out = out.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      waiters.get(msg.id)?.(msg);
    }
  });
  let id = 0;
  return {
    call(method, params = {}) {
      const myId = ++id;
      const p = new Promise((res, rej) => {
        waiters.set(myId, res);
        setTimeout(() => rej(new Error(`no answer for ${method}`)), 30_000).unref();
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
      return p;
    },
    stop: () =>
      proc.exitCode !== null
        ? Promise.resolve()
        : new Promise((r) => {
            proc.once("exit", r);
            proc.stdin.end();
            setTimeout(() => proc.kill("SIGKILL"), 5000).unref();
          }),
  };
}

const textOf = (r) => (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");
const seatMoves = (fake) =>
  fake.state.calls
    .filter((c) => c.name === "iskron_channel")
    .map((c) => c.arguments)
    .filter((a) => ["connect", "mint", "register"].includes(a.action));

const daemonPids = (home) => {
  try {
    const log = readFileSync(join(home, ".iskron-bridge", "run", "daemon.log"), "utf8");
    return [...log.matchAll(/ pid=(\d+) \S+ listening /g)].map((m) => +m[1]);
  } catch {
    return [];
  }
};

for (const [mode, env] of [
  ["the full bridge", { ISKRON_BRIDGE_DAEMON: "0" }],
  ["a thin bridge through the machine's daemon", { ISKRON_BRIDGE_DAEMON_IDLE_MS: "500" }],
]) {
  test(`no seat with an empty name on any path — ${mode}`, async () => {
    const fake = await startFakeNks({ pat: PAT });
    const home = mkdtempSync(join(tmpdir(), "iskron-unnamed-"));
    const b = startBridge(fake.mcpUrl, home, env);
    try {
      assert.ok((await b.call("initialize", INIT)).result, "initialize");
      for (const args of [
        { action: "connect", realm: "nks-dev", karta: 931, name: "" },
        { action: "connect", realm: "nks-dev", karta: 931 },
        { action: "mint", realm: "nks-dev", karta: 931, name: "  " },
        { action: "register", realm: "nks-dev", karta: 931, name: "" },
      ]) {
        const r = await b.call("tools/call", { name: "iskron_channel", arguments: args });
        assert.ok(r.result?.isError, `${JSON.stringify(args)} must be refused: ${textOf(r)}`);
        assert.match(textOf(r), /без имени места/, textOf(r));
      }
      assert.deepEqual(seatMoves(fake), [], "nothing unnamed reached the server");
      for (const name of [undefined, ""]) {
        const r = await b.call("tools/call", {
          name: "iskron_stand",
          arguments: {
            realm: "nks-dev",
            karta: 931,
            model: "opus-5",
            ...(name === undefined ? {} : { name }),
          },
        });
        assert.ok(!r.result?.isError, `iskron_stand stands on the derived name: ${textOf(r)}`);
      }
      const moves = seatMoves(fake);
      assert.ok(moves.length > 0, "iskron_stand took a seat");
      for (const a of moves)
        assert.ok(
          String(a.name ?? "").trim(),
          `a seat move went out unnamed: ${JSON.stringify(a)}`,
        );
    } finally {
      await b.stop();
      for (const pid of daemonPids(home))
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      await fake.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });
}
