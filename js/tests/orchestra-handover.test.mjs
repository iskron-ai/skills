import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BUILT_BRIDGE } from "./built.mjs";

const bridge = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const preload = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "orchestra-pipe.cjs");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = fn();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}
function status(path) {
  return new Promise((resolve, reject) => {
    const s = connect(path);
    let data = "";
    s.setTimeout(2000, () => s.destroy(new Error("door timed out")));
    s.on("error", reject);
    s.on("connect", () => s.write('{"op":"status"}\n'));
    s.on("data", (chunk) => {
      data += chunk;
      if (data.includes("\n")) {
        s.destroy();
        resolve(JSON.parse(data));
      }
    });
  });
}

test(
  "the orchestration door survives a planned daemon handover with a Windows-like name",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "orch-handover-"));
    const home = join(root, "home"),
      auth = join(root, "auth");
    const source = join(root, "release.mjs"),
      homeCopy = join(home, ".iskron-bridge", "iskron-bridge.mjs");
    const journal = join(auth, "run", "daemon.log"),
      door = join(auth, "run", "orchestra.sock");
    mkdirSync(auth, { recursive: true });
    const code = readFileSync(bridge, "utf8");
    writeFileSync(source, code.replaceAll('"iskron-build:dev"', '"iskron-build:release"'));
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      ISKRON_BRIDGE_DAEMON_HOME_CHECK_MS: "200",
    };
    delete env.ISKRON_BRIDGE_NO_UPDATE;
    if (!process.env.ORCHESTRA_TEST_NO_PRELOAD)
      env.NODE_OPTIONS = `${env.NODE_OPTIONS || ""} --require ${preload}`;
    const daemon = spawn(process.execPath, [source, "daemon", "--auth-dir", auth], {
      env,
      stdio: "ignore",
    });
    const logs = () => (existsSync(journal) ? readFileSync(journal, "utf8") : "");
    t.after(async () => {
      daemon.kill("SIGKILL");
      for (const m of logs().matchAll(/ pid=(\d+) \S+ listening /g)) {
        try {
          process.kill(Number(m[1]), "SIGKILL");
        } catch {}
      }
      await delay(200);
      rmSync(root, { recursive: true, force: true });
    });
    await waitFor("the first door", () => existsSync(door) && existsSync(homeCopy));
    assert.equal((await status(door)).ok, true);
    const newer = code.replace(/^((?:const|let|var)\s+VERSION\s*=\s*)"[^"]+"/m, '$1"99.0.0"');
    assert.notEqual(newer, code, "the successor has a newer version");
    writeFileSync(homeCopy, newer);
    await waitFor("the successor", () => /v99\.0\.0\+\S+ listening .*\(successor\)/.test(logs()));
    await waitFor(
      "the former daemon to exit",
      () => daemon.exitCode !== null || daemon.signalCode !== null,
    );
    await delay(300);
    const answer = await status(door).catch((e) => {
      throw new Error(`successor door: ${e.message}\n${logs()}`);
    });
    assert.equal(answer.ok, true, JSON.stringify(answer));
  },
);
