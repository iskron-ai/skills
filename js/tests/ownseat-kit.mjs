// Общее у проб своего места и места рядом (ownseat*.test.mjs): мост под пробой,
// подставной сервер и чтение ответа iskron_stand.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию моста.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SERVICE_ID } from "../shared/serviceid.ts";
import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";

export const NODE = process.env.ISKRON_NODE || process.execPath;
export const FILE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
export const PAT = "nks_pat_stand";
const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "stand-probe", version: "0" },
};

function startBridge(serverUrl, authDir, extra = []) {
  const notifications = [];
  const proc = spawn(NODE, [FILE, serverUrl, "--no-browser", "--auth-dir", authDir, ...extra], {
    env: {
      ...process.env,
      ISKRON_BRIDGE_NO_BROWSER: "1",
      ISKRON_BRIDGE_TOKEN: PAT,
      ISKRON_BRIDGE_NO_UPDATE: "1",
      ISKRON_BRIDGE_DAEMON: "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiters = new Map();
  let out = "";
  let stderr = "";
  proc.stdout.on("data", (c) => {
    out += c;
    let nl;
    while ((nl = out.indexOf("\n")) >= 0) {
      const line = out.slice(0, nl).trim();
      out = out.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id === undefined && msg.method) notifications.push(msg);
      else waiters.get(msg.id)?.(msg);
    }
  });
  proc.stderr.on("data", (c) => (stderr += c));
  let id = 0;
  return {
    notifications,
    get stderr() {
      return stderr;
    },
    /** Смерть без ухода (плагин убит): место не отпущено, запись держания цела. */
    kill: () => proc.kill("SIGKILL"),
    call(method, params = {}, service = false) {
      const next = ++id;
      const myId = service === true ? `${SERVICE_ID}${next}` : next;
      const p = new Promise((res, rej) => {
        waiters.set(myId, res);
        setTimeout(() => rej(new Error(`no answer for ${method}`)), 20_000).unref();
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
      return p;
    },
    stop: (killMs = 3000) =>
      proc.exitCode !== null || proc.signalCode !== null
        ? Promise.resolve()
        : new Promise((r) => {
            proc.once("exit", r);
            proc.stdin.end();
            // Не unref: мост, не вышедший по концу stdin, иначе оставил бы пробу без цикла событий.
            const kill = setTimeout(() => proc.kill("SIGKILL"), killMs);
            proc.once("exit", () => clearTimeout(kill));
          }),
  };
}

export const textOf = (r) => (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");
export const placeOf = (r) => /стояние (?:@[^:\s]+:)?(\S+) — роль/.exec(textOf(r))?.[1];
export const until = async (check, what, ms = 10_000) => {
  for (const end = Date.now() + ms; !(await check());) {
    assert.ok(Date.now() < end, `timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
export const stand = (b, args) => b.call("tools/call", { name: "iskron_stand", arguments: args });
export const channel = (b, args) =>
  b.call("tools/call", { name: "iskron_channel", arguments: args });
export const holdRecord = (dir, key) =>
  readdirSync(join(dir, "standings"))
    .filter((f) => f.endsWith(".hold"))
    .map((f) => JSON.parse(readFileSync(join(dir, "standings", f), "utf8")))
    .find((r) => r.key === key) ?? null;
export const placeArgs = (fake, action) =>
  fake.state.placeArgs.filter((p) => p.action === action).map((p) => p.name);
export const saidKind = (b, kind) => b.notifications.find((n) => n.params?.data?.kind === kind);

/** Каталоги пробы — её же: убираются, когда мосты пробы остановлены. */
const scratches = new WeakMap();
const scratch = (t, prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  scratches.get(t)?.push(d);
  return d;
};
const removed = (d) => {
  try {
    rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    return true;
  } catch {
    return false;
  }
};
/** Что лежит в каталоге и когда менялось — чтобы отличить пишущий мост от остатка. */
const shape = (d) => {
  try {
    return readdirSync(d, { recursive: true })
      .map((f) => {
        try {
          const st = statSync(join(d, f));
          return `${f}:${st.size}:${st.mtimeMs}`;
        } catch {
          return `${f}:gone`;
        }
      })
      .sort()
      .join("\n");
  } catch {
    return "?";
  }
};
/** pid и argv мостов плагина, живых после `ms` ожидания; пусто — вышли все. */
async function bridgesExited(ms) {
  const live = globalThis.__iskronProbeBridges ?? new Set();
  for (const end = Date.now() + ms; live.size && Date.now() < end;)
    await new Promise((r) => setTimeout(r, 50));
  return [...live].map((c) => `${c.pid} ${c.spawnargs.slice(1).join(" ")}`);
}
/** Каталог гранта другой машины — убирается вместе с пробой. */
export const otherDir = (t) => scratch(t, "iskron-ownseat-m2-");

export async function setup(t) {
  const fake = await startFakeNks({ pat: PAT });
  const bridges = [];
  scratches.set(t, []);
  const dir = scratch(t, "iskron-ownseat-");
  const cwd = scratch(t, "iskron-ownseat-cwd-");
  t.after(async () => {
    await fake.stop(); // сервер первым: так мосты выходят по концу stdin, не ждут его
    await Promise.all(bridges.map((b) => b.stop()));
    // Мосты плагина под пробой (rootseat-kit) выходят по концу stdin: уборка ждёт их выхода.
    // Живой и после предела — провал пробы с pid и тем, что лежит в каталогах; вышли все, а
    // каталог не убрался — остаток во временном, слово в вывод, не провал (#8034).
    const alive = await bridgesExited(5_000);
    assert.deepEqual(
      alive,
      [],
      `мост плагина жив после остановки: ${alive.join(", ")}\n${(scratches.get(t) ?? []).map(shape).join("\n")}`,
    );
    for (const d of scratches.get(t) ?? [])
      if (!removed(d)) t.diagnostic(`scratch ${d} not removed: ${shape(d).slice(0, 300)}`);
  });
  // capabilities — what the client declares in initialize (the OpenCode plugin: halts, fields).
  // extra — more arguments of the bridge (--satellite).
  // clientInfo — whose bridge it is: a record's cwd return does not cross harnesses (resumepick.ts).
  const up = async (
    authDir = dir,
    capabilities = INIT.capabilities,
    extra = [],
    clientInfo = INIT.clientInfo,
  ) => {
    const b = startBridge(fake.mcpUrl, authDir, extra);
    bridges.push(b);
    assert.ok((await b.call("initialize", { ...INIT, capabilities, clientInfo })).result);
    return b;
  };
  return { fake, dir, cwd, up };
}

export const write = (b, realm = "nks-dev") =>
  b.call("tools/call", {
    name: "iskron_add_phenomenon",
    arguments: { realm, name: "x", given_as: "ding" },
  });
export const boardLine = (name) =>
  `  #931 👨‍💻 Роль 能 · @tester:${name} — живой · простой 6h · слушает · сокет был сейчас · открыл @tester\n     📥 http://x/api/channel/in/${name}`;
