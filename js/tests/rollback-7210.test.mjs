// Откат машины с ветки канонического адреса графа (запись держания под @owner/slug, прежний
// ключ — в formerKey; граф @nks/nks-dev: решение #8200, вопрос #8677, дело №1580) на выпуск
// v7.21.0 из истории. Утверждения ниже — НАБЛЮДЕНИЕ ОТКАТА, НЕ ТРЕБОВАНИЕ: они держат то, что
// сессия увидела на подставном сервере, чтобы перемена этого поведения была замечена.
//
// История записи: «branch» — место встало сразу на ветке (formerKey нет: переводить нечего);
// «upgrade» — встало на выпуске, ветка перевела запись (formerKey — ключ выпуска).
// A — демон и мост ветки убиты, поднят выпуск тем же каталогом гранта: A1 возврат с диска
//     плагином без вызова, A2 iskron_stand голым слагом, A3 iskron_stand @owner/slug.
// B — демон ветки жив, сессия приходит тонким мостом выпуска: в окне переподхвата прежней
//     сессии и после него.
//
// Клон без тега v7.21.0 — пропуск. ISKRON_BRIDGE_PATH наводит «ветку» на другую копию.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { BUILT_BRIDGE, REPO } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const PAT = "nks_pat_rollback";
const SESSION = "ses_rollback";
const NAME = "otkat";
const OLD_KEY = `${NAME}--931--nks-dev`;
const CANON_KEY = `${NAME}--931--_nks_nks-dev`;
const GRACE_MS = 300; // окно переподхвата демона в варианте «после окна»
const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "opencode-iskron", version: "0" },
};

/** Выпуск v7.21.0 из истории; клон без тега — null. */
function release(to) {
  try {
    const text = execFileSync("git", ["show", "v7.21.0:skills/establish-mcp/scripts/iskron.mjs"], {
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

/** Сборка ветки под версией 7.21.1 — так её видит выпуск. */
function branch(to) {
  const text = readFileSync(BRIDGE, "utf8").replace(
    /^((?:const|let|var)\s+VERSION\s*=\s*)"[^"]+"/m,
    '$1"7.21.1"',
  );
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, text);
  return to;
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
  let out = "";
  let stderr = "";
  proc.stdout.on("data", (c) => {
    out += c;
    for (let nl; (nl = out.indexOf("\n")) >= 0;) {
      const line = out.slice(0, nl).trim();
      out = out.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      waiters.get(msg.id)?.(msg);
    }
  });
  proc.stderr.on("data", (c) => (stderr += c));
  let seq = 0;
  return {
    proc,
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
    async stand(realm, cwd) {
      const r = await this.request("tools/call", {
        name: "iskron_stand",
        arguments: { realm, karta: 931, name: NAME, cwd },
      });
      const text = (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");
      const place = /стояние (?:@[^:\s]+:)?(\S+) — роль/.exec(text)?.[1] ?? null;
      return { isError: !!r.result?.isError, place, text };
    },
  };
}

/** Машина: подставной сервер, каталог гранта, демон и сессия ветки на месте NAME. */
async function machine(t, { resolver, plugin, history, grace }) {
  const scratch = mkdtempSync(join(tmpdir(), "iskron-rollback-"));
  const old = release(join(scratch, "v7.21.0", "iskron.mjs"));
  if (!old) {
    rmSync(scratch, { recursive: true, force: true });
    t.skip("the v7.21.0 tag is not in this clone");
    return null;
  }
  const fresh = branch(join(scratch, "v7.21.1", "iskron.mjs"));
  const fake = await startFakeNks({ pat: PAT, evictSameAddress: true });
  const [dir, home, cwd] = ["auth", "home", "cwd"].map((d) => join(scratch, d));
  for (const d of [dir, cwd]) mkdirSync(d, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    ISKRON_BRIDGE_TOKEN: PAT,
    ISKRON_BRIDGE_NO_BROWSER: "1",
    ISKRON_BRIDGE_NO_UPDATE: "1", // демон — из той копии, что его подняла
    ISKRON_BRIDGE_DAEMON: "1",
    ISKRON_BRIDGE_DAEMON_WAIT_MS: "10000",
    ...(grace ? { ISKRON_BRIDGE_DAEMON_GRACE_MS: String(grace) } : {}),
  };
  const journal = () => {
    try {
      return readFileSync(join(dir, "run", "daemon.log"), "utf8");
    } catch {
      return "";
    }
  };
  const daemons = () => [...journal().matchAll(/ pid=(\d+) \S+ listening /g)].map((m) => +m[1]);
  const kill = (pid) => {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  };
  const procs = [];
  t.after(async () => {
    for (const p of procs) p.kill("SIGKILL");
    daemons().forEach(kill);
    await fake.stop();
    rmSync(scratch, { recursive: true, force: true });
  });
  const ctx = { url: fake.mcpUrl, dir, cwd, env };
  // Плагин после перезапуска спрашивает iskron/resume {cwd, session}; Claude Code — ничего.
  const up = async (file) => {
    const b = thin(file, ctx);
    procs.push(b.proc);
    await b.handshake();
    if (plugin) b.resumed = (await b.request("iskron/resume", { cwd, session: SESSION })).result;
    return b;
  };
  // Мост и демон убиты без ухода, как при замене дома и перезапуске.
  const down = async (b) => {
    b.proc.kill("SIGKILL");
    daemons().forEach(kill);
    await waitFor("the socket to close", () => fake.state.ws.size === 0);
  };
  const stood = (r) => assert.ok(!r.isError && r.place === NAME, r.text);
  let first;
  if (history === "upgrade") {
    const before = await up(old);
    stood(await before.stand("nks-dev", cwd));
    if (resolver) await fake.control({ bareOwnOnly: true });
    await down(before);
    first = await up(fresh); // плагин возвращает место, Claude Code встаёт заново
    if (plugin) assert.equal(first.resumed?.resumed, true, JSON.stringify(first.resumed));
    else stood(await first.stand("nks-dev", cwd));
  } else {
    first = await up(fresh);
    stood(await first.stand("nks-dev", cwd));
    if (resolver) await fake.control({ bareOwnOnly: true });
  }
  const records = () =>
    readdirSync(join(dir, "standings"))
      .filter((f) => f.endsWith(".hold"))
      .map((f) => JSON.parse(readFileSync(join(dir, "standings", f), "utf8")))
      .map((r) => ({ key: r.key, realm: r.realm, formerKey: r.formerKey ?? null }));
  const marks = () => ({
    connect: fake.state.counts.connect,
    places: fake.state.placeArgs.length,
  });
  /** После хода сессии: записи, места графа на доске, принятые connect/register с отметки. */
  const seen = (since) => ({
    records: records(),
    board: [...fake.state.channels.values()]
      .flatMap((c) => [...c.places].filter(([r]) => r === "@nks/nks-dev").map(([, p]) => p.name))
      .sort(),
    connects: fake.state.counts.connect - since.connect,
    placed: fake.state.placeArgs
      .slice(since.places)
      .map((p) => `${p.action}:${p.name}${p.take ? ":take" : ""}`),
    bareRefused: fake.state.counts.bare_refused ?? 0,
  });
  return { fake, cwd, old, first, records, marks, seen, daemons, journal, up, down };
}

const RESOLVER = " — under the resolver released after 7.21.0 (a bare slug is the own graph only)";
const FORMER = { branch: null, upgrade: OLD_KEY };

for (const history of ["branch", "upgrade"])
  for (const resolver of [false, true]) {
    const tail = `${resolver ? RESOLVER : ""}`;

    for (const [label, act] of [
      ["A1 return from disk by the plugin, no call", "resume"],
      ["A2 iskron_stand realm=nks-dev", "nks-dev"],
      ["A3 iskron_stand realm=@nks/nks-dev", "@nks/nks-dev"],
    ])
      test(`rollback (${history}) ${label}: own seat back without take, nothing beside${tail}`, async (t) => {
        const m = await machine(t, { resolver, plugin: act === "resume", history });
        if (!m) return;
        // Наблюдение отката, не требование: запись ветки — под @owner/slug.
        assert.deepEqual(m.records(), [
          { key: CANON_KEY, realm: "@nks/nks-dev", formerKey: FORMER[history] },
        ]);
        await m.down(m.first);
        const since = m.marks();
        const back = await m.up(m.old);
        const reply = act === "resume" ? back.resumed : await back.stand(act, m.cwd);
        const s = m.seen(since);
        const why = `${JSON.stringify(reply)}\n${JSON.stringify(s)}\n${back.stderr}\n${m.journal()}`;
        t.diagnostic(`reply: ${JSON.stringify(reply)}`);
        t.diagnostic(`seen: ${JSON.stringify(s)}`);
        // Наблюдение отката, не требование: выпуск берёт запись под @owner/slug своей
        // (её граф уже канонический), открывает сокет тем же адресом — без connect и take,
        // register на то же имя; formerKey выпуск при перезаписи не хранит.
        if (act === "resume") {
          assert.equal(reply?.resumed, true, why);
          assert.equal(reply?.own, true, why);
          assert.equal(reply?.key, CANON_KEY, why);
          assert.match(reply?.word ?? "", /возврат места с диска/, why);
        } else {
          assert.equal(reply.isError, false, why);
          assert.equal(reply.place, NAME, why);
          assert.match(reply.text, /граф @nks\/nks-dev: возврат места с диска/, why);
        }
        assert.deepEqual(
          s.records,
          [{ key: CANON_KEY, realm: "@nks/nks-dev", formerKey: null }],
          why,
        );
        assert.deepEqual(s.board, [NAME], `no seat beside: ${why}`);
        assert.equal(s.connects, 0, why);
        assert.deepEqual(s.placed, [`register:${NAME}`], why);
        assert.equal(s.bareRefused, 0, why);
      });

    for (const late of [false, true])
      test(`rollback (${history}) B: the branch's daemon alive, the session on the release's thin bridge ${late ? "after" : "within"} the reattach window: own seat, nothing beside${tail}`, async (t) => {
        const m = await machine(t, {
          resolver,
          plugin: true,
          history,
          grace: late ? GRACE_MS : 0,
        });
        if (!m) return;
        const daemon = m.daemons().at(-1);
        m.first.proc.kill("SIGKILL");
        await new Promise((r) => m.first.proc.once("exit", r));
        if (late) await new Promise((r) => setTimeout(r, GRACE_MS * 5));
        process.kill(daemon, 0); // демон ветки жив
        const since = m.marks();
        const back = await m.up(m.old);
        const resumed = back.resumed;
        const again = await back.stand("nks-dev", m.cwd);
        const s = m.seen(since);
        const why = `${JSON.stringify(resumed)}\n${JSON.stringify(again)}\n${JSON.stringify(s)}\n${back.stderr}\n${m.journal()}`;
        t.diagnostic(`resume: ${JSON.stringify(resumed)}`);
        t.diagnostic(`stand: ${JSON.stringify(again)}`);
        t.diagnostic(`seen: ${JSON.stringify(s)}`);
        assert.equal(m.daemons().at(-1), daemon, `no other daemon raised: ${why}`);
        // Наблюдение отката, не требование: тонкий мост выпуска — труба, суждение держит
        // демон ветки; запись остаётся его — с formerKey, если он был.
        assert.equal(resumed?.resumed, true, why);
        assert.equal(resumed?.own, true, why);
        assert.equal(resumed?.key, CANON_KEY, why);
        assert.equal(again.isError, false, why);
        assert.equal(again.place, NAME, why);
        assert.match(again.text, /сокет уже держит этот мост/, why);
        assert.deepEqual(
          s.records,
          [{ key: CANON_KEY, realm: "@nks/nks-dev", formerKey: FORMER[history] }],
          why,
        );
        assert.deepEqual(s.board, [NAME], `no seat beside: ${why}`);
        assert.equal(s.bareRefused, 0, why);
        if (late) {
          // После окна сессия убитого моста кончена: возврат с диска тем же адресом, без connect.
          assert.match(resumed.word, /возврат места с диска/, why);
          assert.equal(s.connects, 0, why);
          assert.deepEqual(s.placed, [`register:${NAME}`, `register:${NAME}`], why);
        } else {
          // В окне переподхвата место ещё у сессии убитого моста: connect, прежний сокет — 4000.
          assert.match(resumed.word, /его держал прежний мост этой же сессии/, why);
          assert.equal(s.connects, 1, why);
          assert.deepEqual(
            s.placed,
            [`connect:${NAME}`, `register:${NAME}`, `register:${NAME}`],
            why,
          );
        }
      });
  }
