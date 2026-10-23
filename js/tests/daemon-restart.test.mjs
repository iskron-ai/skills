// Смена поставки под живой сессией OpenCode (граф nks-dev: #6702, #5151, дело №220):
// обновление кладёт новую сборку в дом — демон прошлого выпуска передаёт места
// преемнику, — и плагин перезапускается тем же ходом: новый тонкий мост той же
// сессии и каталога просит место назад (iskron/resume), пока прежний тонкий мост
// прошлого выпуска ещё жив и вернул место себе у преемника. Место — этой сессии
// (запись держания несёт её): возврат берёт его тем же суждением, что iskron_stand,
// без take и без «держит живой мост».
//
// Прежний мост — сборка тега v7.5.0 из истории (CI берёт её с fetch-depth 0);
// ISKRON_BRIDGE_PATH наводит новый мост и преемника на другую копию.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { BUILT_BRIDGE, REPO } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const PAT = "nks_pat_restart";
const SESSION = "ses_arch";
const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "opencode-iskron", version: "0" },
};

/** Сборка выпуска из истории (по умолчанию v7.5.0); клон без тегов — null. */
function oldRelease(to, tag = "v7.5.0") {
  try {
    const text = execFileSync("git", ["show", `${tag}:skills/establish-mcp/scripts/iskron.mjs`], {
      cwd: REPO,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, text);
    return to;
  } catch {
    return null;
  }
}

async function waitFor(what, fn, ms = 20_000) {
  for (const end = Date.now() + ms; ;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

function thin(file, { url, dir, cwd, env }) {
  const proc = spawn(NODE, [file, url, "--no-browser", "--auth-dir", dir], {
    env,
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiters = new Map();
  const notes = [];
  let out = "";
  let stderr = "";
  proc.stdout.on("data", (c) => {
    out += c;
    for (let nl; (nl = out.indexOf("\n")) >= 0;) {
      const line = out.slice(0, nl).trim();
      out = out.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id === undefined && msg.method) notes.push(msg);
      waiters.get(msg.id)?.(msg);
    }
  });
  proc.stderr.on("data", (c) => (stderr += c));
  let seq = 0;
  return {
    proc,
    notes,
    get stderr() {
      return stderr;
    },
    request(method, params = {}) {
      const id = ++seq;
      const p = new Promise((res, rej) => {
        waiters.set(id, res);
        setTimeout(() => rej(new Error(`no answer for ${method}\n${stderr}`)), 30_000).unref();
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      return p;
    },
    async handshake() {
      assert.ok((await this.request("initialize", INIT)).result, stderr);
      proc.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
      );
    },
  };
}

const textOf = (r) => (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");

test("plugin restart with the daemon change: the session's seat comes back to its new bridge though its former bridge still holds it — no take, no «held by a live bridge»", async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "iskron-restart-"));
  const old = oldRelease(join(scratch, "home", "release", "iskron.mjs"));
  if (!old) return t.skip("the v7.5.0 tag is not in this clone");
  const fake = await startFakeNks({ pat: PAT, evictSameAddress: true });
  const [dir, home, cwd] = ["auth", "home", "cwd"].map((d) => join(scratch, d));
  for (const d of [dir, cwd]) mkdirSync(d, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    ISKRON_BRIDGE_TOKEN: PAT,
    ISKRON_BRIDGE_NO_BROWSER: "1",
    ISKRON_BRIDGE_DAEMON: "1",
    ISKRON_BRIDGE_DAEMON_WAIT_MS: "10000",
    ISKRON_BRIDGE_DAEMON_HOME_CHECK_MS: "200",
  };
  delete env.ISKRON_BRIDGE_NO_UPDATE; // обновление — дело демона; дом — временный
  const journal = () => {
    try {
      return readFileSync(join(dir, "run", "daemon.log"), "utf8");
    } catch {
      return "";
    }
  };
  const procs = [];
  t.after(async () => {
    for (const p of procs) p.kill("SIGKILL");
    for (const m of journal().matchAll(/ pid=(\d+) \S+ listening /g)) {
      try {
        process.kill(+m[1], "SIGKILL");
      } catch {}
    }
    await fake.stop();
    rmSync(scratch, { recursive: true, force: true });
  });
  const ctx = { url: fake.mcpUrl, dir, cwd, env };
  const record = () =>
    readdirSync(join(dir, "standings"))
      .filter((f) => f.endsWith(".hold"))
      .map((f) => JSON.parse(readFileSync(join(dir, "standings", f), "utf8")));

  // Прошлый выпуск: демон и тонкий мост сессии на её месте.
  const daemon = spawn(NODE, [old, "daemon", "--auth-dir", dir], { env, stdio: "ignore" });
  procs.push(daemon);
  const homeCopy = join(home, ".iskron-bridge", "iskron-bridge.mjs");
  await waitFor("the old daemon to put itself home", () => existsSync(homeCopy));
  const former = thin(old, ctx);
  procs.push(former.proc);
  await former.handshake();
  await former.request("iskron/resume", { cwd, session: SESSION }); // плагин называет сессию
  const stood = await former.request("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 2270, name: "arch", cwd },
  });
  assert.ok(!stood.result?.isError, textOf(stood));
  const [rec] = record();
  assert.equal(rec?.session, SESSION, "the record names the session that stood");

  // Обновление: новая сборка в дом — демон уходит к преемнику; прежний тонкий мост
  // переподхватывается и возвращает место себе, а плагин уже поднял новый мост сессии.
  copyFileSync(BRIDGE, homeCopy);
  await waitFor("the former bridge's seat back on the successor", () =>
    /standing resumed from disk|socket held/.test(
      former.stderr.split("hands over to its successor")[1] ?? "",
    ),
  );
  const fresh = thin(homeCopy, ctx);
  procs.push(fresh.proc);
  await fresh.handshake();
  const connects = fake.state.counts.connect;
  const back = (await fresh.request("iskron/resume", { key: rec.key, cwd, session: SESSION }))
    .result;
  const why = `${JSON.stringify(back)}\nnew:\n${fresh.stderr}\nformer:\n${former.stderr}\n${journal()}`;
  assert.doesNotMatch(back?.word ?? "", /держит живой мост/, why);
  assert.equal(back?.resumed, true, why);
  // The release's record named the graph as the agent did (nks-dev); the successor moved it to
  // @owner/slug (#8677) and answers the earlier key with the seat's canonical one.
  const canonKey = "arch--2270--_nks_nks-dev";
  assert.equal(rec.key, "arch--2270--nks-dev", "the release keyed the seat by the bare slug");
  assert.equal(back?.key, canonKey, why);
  assert.ok(fake.state.counts.connect > connects, `the socket is the new bridge's own: ${why}`);
  const again = await fresh.request("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 2270, name: "arch", cwd },
  });
  assert.match(textOf(again), /сокет уже держит этот мост/, textOf(again));
  assert.ok(
    !fake.state.placeArgs.some((p) => /^arch\.\d+$/.test(p.name ?? "")),
    `no seat beside: ${JSON.stringify(fake.state.placeArgs)}`,
  );
  const moved = record().find((r) => r.key === canonKey);
  assert.equal(moved?.session, SESSION, why);
  assert.equal(moved?.realm, "@nks/nks-dev", why);
  assert.equal(moved?.formerKey, rec.key, "the moved record keeps the release's key");
  assert.equal(record().length, 1, `the release's record is not left beside: ${why}`);
});

// Переход с выпуска v7.10.0 (#7602): его демон отпускает место рядом и его тонкий мост
// при переподхвате сразу говорит lost, но преемник этой ветки возвращает место рядом
// вместе с основным — прежний тонкий мост снимает отказ по слову beside до конца ворот:
// запись во второй граф проходит без iskron_stand, нового места на доске нет.
test("from v7.10.0: the successor brings the beside seat back — the former thin bridge's lost is lifted before its gate opens", async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "iskron-beside-"));
  const old = oldRelease(join(scratch, "home", "release", "iskron.mjs"), "v7.10.0");
  if (!old) return t.skip("the v7.10.0 tag is not in this clone");
  const fake = await startFakeNks({ pat: PAT, evictSameAddress: true });
  const [dir, home, cwd] = ["auth", "home", "cwd"].map((d) => join(scratch, d));
  for (const d of [dir, cwd]) mkdirSync(d, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    ISKRON_BRIDGE_TOKEN: PAT,
    ISKRON_BRIDGE_NO_BROWSER: "1",
    ISKRON_BRIDGE_DAEMON: "1",
    ISKRON_BRIDGE_DAEMON_WAIT_MS: "10000",
    ISKRON_BRIDGE_DAEMON_HOME_CHECK_MS: "200",
  };
  delete env.ISKRON_BRIDGE_NO_UPDATE;
  const journal = () => {
    try {
      return readFileSync(join(dir, "run", "daemon.log"), "utf8");
    } catch {
      return "";
    }
  };
  const procs = [];
  t.after(async () => {
    for (const p of procs) p.kill("SIGKILL");
    for (const m of journal().matchAll(/ pid=(\d+) \S+ listening /g)) {
      try {
        process.kill(+m[1], "SIGKILL");
      } catch {}
    }
    await fake.stop();
    rmSync(scratch, { recursive: true, force: true });
  });
  const daemon = spawn(NODE, [old, "daemon", "--auth-dir", dir], { env, stdio: "ignore" });
  procs.push(daemon);
  const homeCopy = join(home, ".iskron-bridge", "iskron-bridge.mjs");
  await waitFor("the old daemon to put itself home", () => existsSync(homeCopy));
  const former = thin(old, { url: fake.mcpUrl, dir, cwd, env });
  procs.push(former.proc);
  await former.handshake();
  const stand = (realm, karta) =>
    former.request("tools/call", {
      name: "iskron_stand",
      arguments: { realm, karta, name: "two", cwd },
    });
  for (const [realm, karta] of [
    ["nks-dev", 931],
    ["drugoy", 48],
  ]) {
    const r = await stand(realm, karta);
    assert.ok(!r.result?.isError, textOf(r));
  }
  const kinds = () =>
    former.notes.map((n) => `${n.params?.data?.kind}:${n.params?.data?.key ?? ""}`);
  const besideKey = "two--48--drugoy";
  await waitFor("the beside word", () => kinds().includes(`beside:${besideKey}`));
  const connects = fake.state.counts.connect;

  // Ветка в дом под старшей версией — демон выпуска уходит к её преемнику.
  const newer = readFileSync(BRIDGE, "utf8").replace(
    /^((?:const|let|var)\s+VERSION\s*=\s*)"[^"]+"/m,
    '$1"99.0.0"',
  );
  writeFileSync(homeCopy, newer);
  const why = () => `${JSON.stringify(kinds())}\n${former.stderr}\n${journal()}`;
  await waitFor(
    "the beside seat back on the successor",
    () => kinds().filter((k) => k === `beside:${besideKey}`).length === 2,
    30_000,
  ).catch((e) => {
    throw new Error(`${e.message}\n${why()}`);
  });
  // Что видит сессия: прежний тонкий мост говорит lost по месту рядом, затем beside снимает его.
  const seen = kinds();
  t.diagnostic(`the session saw: ${seen.join(" ")}`);
  const lostAt = seen.indexOf(`lost:${besideKey}`);
  assert.ok(lostAt < 0 || lostAt < seen.lastIndexOf(`beside:${besideKey}`), why());
  const before = fake.state.writes.length;
  const there = await former.request("tools/call", {
    name: "iskron_add_phenomenon",
    arguments: { realm: "drugoy", name: "после перехода" },
  });
  assert.ok(there.result && !there.result.isError, `${JSON.stringify(there)}\n${why()}`);
  assert.equal(fake.state.writes.at(-1)?.author, "two", JSON.stringify(fake.state.writes));
  assert.equal(fake.state.writes.length, before + 1);
  assert.equal(fake.state.counts.unattributed, 0, JSON.stringify(fake.state.writes));
  assert.equal(fake.state.counts.connect, connects, "no new connect");
  const drugoy = [...fake.state.channels.values()].filter((c) => c.places.has("@nks/drugoy"));
  assert.equal(drugoy.length, 1, `one seat in drugoy on the board: ${why()}`);
});

// Переполнение журнала приходится на шумный миг — смену демона, — и журнал, стёртый
// целиком, терял ровно то, что после неё разбирают (поле 7.5.0→7.6.0: daemon.log
// начинался после смены, standings.log — через десять минут). Прежний — в `.1`.
test("an overfull daemon.log and standings.log start anew with the former kept beside as .1, not erased", async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "iskron-journal-"));
  const fake = await startFakeNks({ pat: PAT });
  const procs = [];
  t.after(async () => {
    for (const p of procs) p.kill("SIGKILL");
    await fake.stop();
    rmSync(scratch, { recursive: true, force: true });
  });
  const dir = join(scratch, "auth");
  mkdirSync(join(dir, "run"), { recursive: true, mode: 0o700 }); // вход демона — только личный
  const before = "BEFORE-THE-CHANGE ".repeat(16_000) + "\n"; // за пределами обоих журналов
  writeFileSync(join(dir, "run", "daemon.log"), before);
  writeFileSync(join(dir, "standings.log"), before);
  const env = {
    ...process.env,
    HOME: join(scratch, "home"),
    ISKRON_BRIDGE_TOKEN: PAT,
    ISKRON_BRIDGE_NO_BROWSER: "1",
    ISKRON_BRIDGE_NO_UPDATE: "1",
    ISKRON_BRIDGE_DAEMON: "1",
    ISKRON_BRIDGE_DAEMON_WAIT_MS: "10000",
  };
  const b = thin(BRIDGE, { url: fake.mcpUrl, dir, cwd: scratch, env });
  procs.push(b.proc);
  await b.handshake();
  const stood = await b.request("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "journal" },
  });
  assert.ok(!stood.result?.isError, textOf(stood));
  for (const p of ["run/daemon.log", "standings.log"]) {
    const now = readFileSync(join(dir, p), "utf8");
    assert.doesNotMatch(now, /BEFORE-THE-CHANGE/, `${p} starts anew`);
    assert.match(now, /\S/, `${p} goes on`);
    const kept = join(dir, `${p}.1`);
    assert.ok(existsSync(kept), `${p}.1 keeps the former journal`);
    assert.equal(readFileSync(kept, "utf8"), before, `${p}.1 is the former journal whole`);
  }
  for (const m of readFileSync(join(dir, "run", "daemon.log"), "utf8").matchAll(
    / pid=(\d+) \S+ listening /g,
  ))
    procs.push({
      kill: (s) => {
        try {
          process.kill(+m[1], s);
        } catch {}
      },
    });
});
