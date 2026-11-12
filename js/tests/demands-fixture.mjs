import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BUILT_BRIDGE } from "./built.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;

export function command(dir, args) {
  const p = spawn(NODE, [BRIDGE, "orchestra", ...args, "--auth-dir", dir], {
    env: { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  p.stdout.on("data", (c) => (out += c));
  p.stderr.on("data", (c) => (err += c));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => p.kill("SIGKILL"), 20_000);
    p.once("error", reject);
    p.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

export async function fixture(reply, realms = ["@probe/one", "@probe/two"], env = {}) {
  const calls = [];
  const server = createServer((req, res) => {
    calls.push({ method: req.method, path: req.url });
    if (req.headers.authorization !== "Bearer demands-probe") {
      res.writeHead(401).end();
      return;
    }
    const r = reply(req.url);
    res.writeHead(r.status || 200, { "content-type": "application/json", ...r.headers });
    res.end(JSON.stringify(r.body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = mkdtempSync(join(tmpdir(), "demands-probe-"));
  writeFileSync(join(dir, "server"), `${base}/mcp\n`);
  writeFileSync(join(dir, "token"), "demands-probe", { mode: 0o600 });
  mkdirSync(join(dir, "standings"));
  realms.forEach((realm, i) =>
    writeFileSync(
      join(dir, "standings", `probe-${i}.hold`),
      JSON.stringify({
        realm,
        karta: 1,
        name: `probe-${i}`,
        url: `${base}/channel/ws/${i}`,
        at: Date.now(),
      }),
    ),
  );
  const daemon = spawn(NODE, [BRIDGE, "daemon", "--auth-dir", dir], {
    env: {
      ...process.env,
      ISKRON_BRIDGE_NO_UPDATE: "1",
      ISKRON_BRIDGE_DAEMON_IDLE_MS: "60000",
      ...env,
    },
    stdio: "ignore",
  });
  const close = async () => {
    if (daemon.exitCode === null && daemon.signalCode === null) {
      const ended = new Promise((resolve) => daemon.once("exit", resolve));
      daemon.kill("SIGKILL");
      await ended;
    }
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    for (let i = 0; ; i++) {
      const r = await command(dir, ["status"]);
      if (r.code === 0) break;
      if (i > 50) throw new Error(`daemon not ready: ${r.err}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } catch (e) {
    await close();
    throw e;
  }
  return {
    dir,
    calls,
    close,
    read: (...r) => command(dir, ["demands", ...r.flatMap((x) => ["--realm", x])]),
  };
}
