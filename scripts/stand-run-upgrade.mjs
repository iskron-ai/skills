#!/usr/bin/env node
// The transition layer of the live bridge run: bridges of the previous release hold the seats of
// two sessions (a main seat each, one seat beside in a second graph), then the home copy is
// replaced by the candidate build, as a self-update does, and the machine daemon hands over to
// it. Every seat must come back to its own session without take, nobody stands beside, the board
// has no doubles (graph @nks/nks-dev, node #6702; iskron-ai/skills AGENTS.md, «Живой прогон
// моста до релиза»). No human: a PAT file, an isolated HOME.
//
//   node scripts/stand-run-upgrade.mjs --old OLD.mjs --new NEW.mjs --token-file F --url U \
//     --realm @owner/a --realm2 @owner/b [--keep]
//
// NEW must carry a higher version than OLD: the daemon hands over only to a newer build.
// Exit 0 — passed, 1 — a check failed, 2 — setup failed.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const [oldFile, newFile, tokenFile, URL_, realm, realm2] = ["--old", "--new", "--token-file", "--url", "--realm", "--realm2"].map((n) => arg(n));
const keep = process.argv.includes("--keep");
const fail = (code, t) => (process.stderr.write(`stand-run-upgrade: ${t}\n`), process.exit(code));
if (![oldFile, newFile, tokenFile, URL_, realm, realm2].every(Boolean)) fail(2, "--old, --new, --token-file, --url, --realm, --realm2 are required");
if ((statSync(tokenFile).mode & 0o077) !== 0) fail(2, `${tokenFile} is readable by others — chmod 600`);
const token = readFileSync(tokenFile, "utf8").trim();
const versionOf = (f) => spawnSync(process.execPath, [f, "--version"], { env: envBase(), encoding: "utf8" }).stdout.split("\n")[0].trim();

const run = mkdtempSync(join(tmpdir(), "stand-up-"));
const home = join(run, "home");
const bridgeHome = join(home, ".iskron-bridge"); // the home copy and the default auth dir
mkdirSync(bridgeHome, { recursive: true, mode: 0o700 });
writeFileSync(join(bridgeHome, "token"), token + "\n", { mode: 0o600 });
const homeCopy = join(bridgeHome, "iskron-bridge.mjs");
copyFileSync(oldFile, homeCopy);
function envBase() {
  const e = { ...process.env, HOME: home, ISKRON_BRIDGE_URL: URL_, ISKRON_BRIDGE_DAEMON_HOME_CHECK_MS: "2000" };
  for (const k of ["ISKRON_BRIDGE_TOKEN", "ISKRON_BRIDGE_AUTH_DIR", "ISKRON_BRIDGE_NO_UPDATE", "ISKRON_BRIDGE_PATH"]) delete e[k];
  return e;
}
const vOld = versionOf(oldFile);
const vNew = versionOf(newFile);

const report = [`old ${vOld} · new ${vNew} · realms ${realm}, ${realm2}`];
let failed = 0;
const check = (ok, what, seen) => {
  report.push(`${ok ? "PASS" : "FAIL"} ${what}${seen ? ` — ${String(seen).slice(0, 220)}` : ""}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");
const standingsLog = () => read(join(bridgeHome, "standings.log"));
const daemonLog = () => read(join(bridgeHome, "run/daemon.log"));

// A harness session: a thin bridge started from the home copy, as harnesses start it.
function session(name) {
  const child = spawn(process.execPath, [homeCopy], { env: envBase(), cwd: run, stdio: ["pipe", "pipe", "pipe"] });
  const replies = new Map();
  const notes = [];
  let buf = "";
  let err = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      const l = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const m = JSON.parse(l);
        if (m.id !== undefined && !m.method) replies.set(m.id, m);
        else if (m.method) notes.push(m);
      } catch {}
    }
  });
  child.stderr.on("data", (d) => (err += d));
  let id = 1;
  const req = async (method, params) => {
    const my = id++;
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: my, method, params }) + "\n");
    for (let t = 0; t < 900; t++) {
      if (replies.has(my)) return replies.get(my);
      await sleep(100);
    }
    throw new Error(`${name}: no reply to ${method}`);
  };
  return {
    name,
    child,
    notes,
    stderr: () => err,
    async init() {
      const r = await req("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: `stand-up-${name}`, version: "0" } });
      if (r.error) throw new Error(`${name}: initialize — ${JSON.stringify(r.error).slice(0, 200)}`);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    },
    async call(tool, args) {
      const r = await req("tools/call", { name: tool, arguments: args });
      return { text: (r.result?.content ?? []).map((c) => c.text ?? "").join("\n"), error: !!(r.error || r.result?.isError) };
    },
    close() {
      if (child.exitCode !== null) return Promise.resolve();
      const done = new Promise((r) => child.once("exit", r));
      child.stdin.end();
      child.kill("SIGTERM");
      return Promise.race([done, sleep(10_000)]);
    },
  };
}

const seatLines = (board) => board.split("\n").filter((l) => /^\s*#\d+ .* · @[\w.-]+:\S+ —/.test(l));
const seatNames = (board) => seatLines(board).map((l) => l.match(/ · @[\w.-]+:(\S+) —/)[1]).filter((n) => n.startsWith(`up-${stamp}.`));
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const n1 = `up-${stamp}.s1`;
const n2 = `up-${stamp}.s2`;
const n1b = `up-${stamp}.s1b`;

const S1 = session("s1");
const S2 = session("s2");
const P = session("person");
try {
  await S1.init();
  await S2.init();
  await P.init();
  const pidsBefore = [S1.child.pid, S2.child.pid];
  const mk = async (r) => {
    const k = await P.call("iskron_add_karta", {
      realm: r,
      name: "🧪 Агент перехода моста",
      motivation: "Держит место, чтобы прогон проверил возврат места при обновлении моста.",
      manifested_as: "adhikarin",
      epistemic_mode: "pratyakshita",
      ontic_mode: "vartamana",
      volitive_mode: "upeksha",
    });
    const id = (k.text.match(/\(#(\d+)\)/) || [])[1];
    if (!id) throw new Error(`karta in ${r}: ${k.text.slice(0, 200)}`);
    return id;
  };
  const k1 = await mk(realm);
  const k2 = await mk(realm2);
  const board = async () => (await P.call("iskron_channel", { realm, action: "list", karta: `#${k1}` })).text;
  const board2 = async () => (await P.call("iskron_channel", { realm: realm2, action: "list", karta: `#${k2}` })).text;

  // The previous release holds the seats.
  const a = await S1.call("iskron_stand", { realm, karta: `#${k1}`, name: n1, model: "stand-run" });
  const b = await S1.call("iskron_stand", { realm: realm2, karta: `#${k2}`, name: n1b, model: "stand-run" });
  const c = await S2.call("iskron_stand", { realm, karta: `#${k1}`, name: n2, model: "stand-run" });
  check(!a.error && !b.error && !c.error, "old release: three seats held", [a, b, c].map((x) => x.text.split("\n")[0].slice(0, 70)).join(" | "));
  check(/v7\.9\.0|through the machine's bridge daemon/.test(S1.stderr()), "old release: the sessions go through the machine daemon", (S1.stderr().match(/through the machine's bridge daemon[^\n]*/) || [""])[0]);
  const heldBefore = standingsLog().split("\n").filter((l) => / held /.test(l)).length;

  // The update: the home copy is replaced atomically by the candidate, as a self-update writes it.
  const tmp = `${homeCopy}.new`;
  copyFileSync(newFile, tmp);
  renameSync(tmp, homeCopy);
  const tUp = Date.now();
  let handed = false;
  for (let t = 0; t < 60 && !handed; t++) {
    await sleep(1000);
    handed = /\(successor\)/.test(daemonLog()) && / v7\.10|\(successor\)/.test(daemonLog());
  }
  check(handed, "the daemon hands over to a successor of the new build", (daemonLog().match(/[^\n]*(handing over|hands over)[^\n]*/) || [""])[0]);
  await sleep(20_000);

  const log = standingsLog().split("\n");
  for (const n of [n1, n2]) {
    const own = log.filter((l) => l.includes(`${n}--`));
    check(own.some((l) => /handed over|resumed-from-disk/.test(l)), `${n}: resumed by the successor (standings.log)`, own.filter((l) => /handed|resumed/.test(l)).join(" | "));
    check(!own.some((l) => / stopped | released /.test(l) && Date.parse(l.slice(0, 24)) > tUp), `${n}: not released or stopped by the update`);
  }
  // The seat beside in another graph: by the documented ceiling the successor does not return
  // it — the session gets a lost notice, writes into that graph are refused until iskron_stand
  // there, and that stand takes the same name, not a name beside.
  const ownB = log.filter((l) => l.includes(`${n1b}--`));
  const resumedB = ownB.some((l) => /resumed-from-disk/.test(l) && Date.parse(l.slice(0, 24)) > tUp);
  report.push(`INFO ${n1b} (beside, second graph): ${resumedB ? "resumed by the successor" : "NOT resumed"} — ${ownB.filter((l) => Date.parse(l.slice(0, 24)) >= tUp).map((l) => l.slice(25, 200)).join(" | ")}`);
  const lostNote = S1.notes.find((m) => /lost|потерян/.test(JSON.stringify(m)) && JSON.stringify(m).includes(n1b));
  if (!resumedB) {
    check(!!lostNote, `${n1b}: the session is told the seat beside was lost`, lostNote ? JSON.stringify(lostNote.params?.data ?? lostNote.params).slice(0, 200) : `notes: ${S1.notes.length}`);
    const w = await S1.call("iskron_stand", { realm: realm2, karta: `#${k2}`, status: "write into the lost graph" });
    report.push(`INFO s1: a busy line in the lost graph before standing there — ${w.error ? "refused" : "accepted"}: ${w.text.split("\n")[0].slice(0, 160)}`);
    const back = await S1.call("iskron_stand", { realm: realm2, karta: `#${k2}`, name: n1b, model: "stand-run" });
    check(!back.error && back.text.includes(n1b) && !new RegExp(`${n1b.replace(/\./g, "\\.")}\\.\\d`).test(back.text), `${n1b}: an explicit stand returns the same name`, back.text.split("\n")[0]);
  }
  const names1 = seatNames(await board());
  const names2 = seatNames(await board2());
  check(names1.includes(n1) && names1.includes(n2) && names2.includes(n1b), "board: every seat still stands", `${names1.join(",")} / ${names2.join(",")}`);
  check(!names1.concat(names2).some((n) => /\.\d+$/.test(n.replace(/^up-\d+\./, ""))) && names1.length === 2 && names2.length === 1, "board: no seat beside, no doubles", `${names1.join(",")} / ${names2.join(",")}`);
  check(!/take=true|take: true/.test(daemonLog()), "no take in the transition");
  const heldAfter = standingsLog().split("\n").filter((l) => / held /.test(l)).length;
  report.push(`INFO held lines: ${heldBefore} before the update, ${heldAfter} after`);
  check(pidsBefore[0] === S1.child.pid && S1.child.exitCode === null && S2.child.exitCode === null, "thin bridges are the same processes, alive");

  // The sessions still work as themselves: a call goes through, the seat hears.
  const who = await S1.call("iskron_me", { action: "whoami" });
  check(!who.error, "s1: a graph call after the update", who.text.split("\n")[0]);
  const st = await S2.call("iskron_stand", { realm, karta: `#${k1}`, status: "after the update" });
  check(!st.error && !/рядом|beside/i.test(st.text), "s2: busy line on its own seat after the update, no seat beside", st.text.split("\n")[0]);
  const before = S1.notes.length;
  const sent = await P.call("iskron_channel", { realm, action: "send", karta: `#${k1}`, standing: n1, text: "stand-run: after the update", as_person: true });
  let heard = false;
  for (let t = 0; t < 30 && !heard; t++) {
    await sleep(1000);
    heard = S1.notes.slice(before).some((m) => JSON.stringify(m).includes("after the update"));
  }
  check(!sent.error && heard, "s1: a word to its seat reaches its session after the update", sent.text.split("\n")[0]);
  const ver = spawnSync(process.execPath, [homeCopy, "--version"], { env: envBase(), encoding: "utf8" }).stdout.split("\n");
  check(ver[1]?.includes(vNew.split("+")[0].replace(/^v/, "")) ?? false, "the daemon now runs the new build", ver[1]);

  for (const [r, k, n] of [[realm, k1, n1], [realm, k1, n2], [realm2, k2, n1b]]) {
    const brd = (await P.call("iskron_channel", { realm: r, action: "list", karta: `#${k}` })).text;
    const line = brd.split("\n");
    const i = line.findIndex((l) => l.includes(`:${n} —`));
    const id = i === -1 ? null : line.slice(i, i + 8).map((l) => l.match(/^\s+id ([0-9a-f-]{36})/)?.[1]).find(Boolean);
    if (id) await P.call("iskron_channel", { realm: r, action: "revoke", karta: `#${k}`, channel: id, as_person: true });
  }
} catch (e) {
  report.push(`ERROR ${e.message}`);
  failed++;
} finally {
  await Promise.all([S1.close(), S2.close(), P.close()]);
}
process.stdout.write(report.join("\n").split(token).join("<token>") + "\n");
spawnSync("pkill", ["-f", `${homeCopy} daemon`]);
spawnSync("pkill", ["-f", `daemon --auth-dir ${bridgeHome}( |$)`]);
await sleep(1500);
process.stdout.write(`\nrun dir: ${run}${keep ? "" : " (removed)"}\n`);
if (!keep) rmSync(run, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
process.exit(failed ? 1 : 0);
