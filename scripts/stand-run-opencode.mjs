#!/usr/bin/env node
// The OpenCode layer of the live bridge run: an isolated `opencode serve` with the dev-built
// plugin and bridge against a PAT carrier, no human. A seat taken off by a person stops its
// session (graph @nks/nks-dev, node #7439): the running turn is cut, the waiting session is not
// woken, a plugin reload does not wake either, and an explicit stand lifts the ban.
//
//   node scripts/stand-run-opencode.mjs --token-file F --url U --realm @owner/slug [--model provider/id] [--keep]
//
// The token file: one line, mode 0600. Model keys come from this machine's `opencode auth export`
// (key entries of anthropic/openai only) into the isolated home. Exit 0 — passed, 1 — a check
// failed, 2 — setup failed.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const tokenFile = arg("--token-file");
const URL_ = arg("--url");
const realm = arg("--realm");
const [providerID, modelID] = arg("--model", "anthropic/claude-sonnet-5-5").split("/");
const keep = process.argv.includes("--keep");
const bridge = join(root, "dist/dev/skills/establish-mcp/scripts/iskron.mjs");
const plugin = join(root, "dist/dev/skills/establish-mcp/scripts/opencode-plugin.js");
const fail = (code, t) => (process.stderr.write(`stand-run-opencode: ${t}\n`), process.exit(code));
if (!tokenFile || !URL_ || !realm) fail(2, "--token-file, --url and --realm are required");
if (!existsSync(bridge) || !existsSync(plugin)) fail(2, "no dev build — make build-js");
if ((statSync(tokenFile).mode & 0o077) !== 0) fail(2, `${tokenFile} is readable by others — chmod 600`);
const token = readFileSync(tokenFile, "utf8").trim();
const opencode = spawnSync("sh", ["-c", "command -v opencode"]).stdout.toString().trim();

const run = mkdtempSync(join(tmpdir(), "stand-oc-"));
const home = join(run, "home");
const cwd = join(run, "project");
const auth = join(run, "auth");
const oc = join(home, ".config/opencode");
for (const d of [cwd, join(oc, "plugins"), join(home, ".local/share"), join(home, ".local/state"), join(home, ".cache"), join(home, "tmp")])
  mkdirSync(d, { recursive: true });
mkdirSync(auth, { recursive: true, mode: 0o700 });
writeFileSync(join(auth, "token"), token + "\n", { mode: 0o600 });
cpSync(plugin, join(oc, "plugins/iskron.js"));

// Provider settings from the machine config (comments stripped), nothing else.
const machine = readFileSync(join(homedir(), ".config/opencode/opencode.jsonc"), "utf8")
  .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s) => s ?? "")
  .replace(/,(\s*[}\]])/g, "$1");
const m = JSON.parse(machine);
writeFileSync(
  join(oc, "opencode.jsonc"),
  JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model: `${providerID}/${modelID}`,
    permissions: [
      { action: "*", resource: "*", effect: "allow" },
      { action: "external_directory", resource: "*", effect: "deny" },
    ],
    providers: Object.fromEntries(["anthropic", "openai"].filter((p) => m.providers?.[p]).map((p) => [p, m.providers[p]])),
  }),
);

const env = {
  PATH: `${dirname(opencode)}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  HOME: home,
  TMPDIR: join(home, "tmp"),
  LANG: "en_US.UTF-8",
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local/share"),
  XDG_STATE_HOME: join(home, ".local/state"),
  XDG_CACHE_HOME: join(home, ".cache"),
  OPENCODE_CONFIG_DIR: oc,
  ISKRON_BRIDGE_PATH: bridge,
  ISKRON_BRIDGE_AUTH_DIR: auth,
  ISKRON_BRIDGE_URL: URL_,
  ISKRON_BRIDGE_NO_UPDATE: "1",
  ISKRON_BRIDGE_NO_BROWSER: "1",
};

// Model keys: export from the real home, keep key entries, import into the isolated one.
{
  const exp = spawnSync(opencode, ["auth", "export"], { encoding: "utf8" });
  const keys = JSON.parse(exp.stdout || "[]").filter((e) => ["anthropic", "openai"].includes(e.integrationID) && e.value?.type === "key");
  const kf = join(home, "tmp/keys.json");
  writeFileSync(kf, JSON.stringify(keys), { mode: 0o600 });
  const imp = spawnSync(opencode, ["auth", "import", "--standalone", kf], { env, cwd, encoding: "utf8" });
  rmSync(kf, { force: true });
  if (imp.status !== 0) fail(2, `auth import: ${imp.stderr.slice(0, 300)}`);
}

const report = [];
let failed = 0;
const check = (ok, what, seen) => {
  report.push(`${ok ? "PASS" : "FAIL"} ${what}${seen ? ` — ${String(seen).slice(0, 200)}` : ""}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 40000 + Math.floor(Math.random() * 20000);
const server = `http://127.0.0.1:${port}`;
let serve = null;
const startServe = async () => {
  serve = spawn(opencode, ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--print-logs", "--log-level", "warn"], {
    env,
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  serve.stdout.on("data", (d) => {
    out += d;
    const pw = out.match(/server password (\S+)/);
    if (pw) env.OPENCODE_PASSWORD = pw[1];
  });
  serve.stderr.on("data", (d) => writeFileSync(join(run, "serve.log"), d, { flag: "a" }));
  for (let i = 0; i < 120; i++) {
    if (api("GET", "/api/session/active").ok) return;
    await sleep(500);
  }
  throw new Error("serve did not come up");
};
const stopServe = async () => {
  delete env.OPENCODE_PASSWORD;
  if (!serve || serve.exitCode !== null) return;
  const done = new Promise((r) => serve.once("exit", r));
  serve.kill("SIGTERM");
  await Promise.race([done, sleep(15_000)]);
};
function api(method, path, body) {
  const a = ["api", "--server", server, method, path];
  if (body) a.push("-d", JSON.stringify(body));
  const r = spawnSync(opencode, a, { env, cwd, encoding: "utf8" });
  let data = null;
  try {
    data = JSON.parse(r.stdout);
  } catch {}
  return { ok: r.status === 0 && data !== null && !data?._tag, data, raw: r.stdout + r.stderr };
}
const active = () => Object.keys(api("GET", "/api/session/active").data?.data ?? {});
const messages = (id) => {
  const d = api("GET", `/api/session/${id}/message?limit=200`).data;
  const list = d?.data ?? d;
  return Array.isArray(list) ? list : Array.isArray(list?.items) ? list.items : [];
};
const inbox = (id) => {
  const d = api("GET", `/api/session/${id}/inbox`).data;
  const l = d?.data ?? d;
  return Array.isArray(l) ? l : [];
};
const hasStopWord = (x) => /остановлен|you are stopped/.test(JSON.stringify(x));
const prompt = (id, text) => {
  const r = api("POST", `/api/session/${id}/prompt`, { text, resume: true });
  if (!r.ok) throw new Error(`prompt ${id}: ${r.raw.slice(0, 300)}`);
  return r;
};
const newSession = (title) => {
  const r = api("POST", "/api/session", { title, location: { directory: cwd }, model: { providerID, id: modelID } });
  const s = r.data?.data ?? r.data;
  if (!s?.id) throw new Error(`session create: ${r.raw.slice(0, 300)}`);
  return s;
};

// The person: a bridge of the same account that holds no seat — its revoke counts as a person's.
function stdioBridge() {
  const child = spawn("node", [bridge], {
    env: { ...env, ISKRON_BRIDGE_AUTH_DIR: join(run, "auth-person") },
    stdio: ["pipe", "pipe", "ignore"],
  });
  mkdirSync(join(run, "auth-person"), { recursive: true, mode: 0o700 });
  writeFileSync(join(run, "auth-person/token"), token + "\n", { mode: 0o600 });
  const rep = new Map();
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      const l = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const msg = JSON.parse(l);
        if (msg.id !== undefined && !msg.method) rep.set(msg.id, msg);
      } catch {}
    }
  });
  let id = 1;
  const req = async (method, params) => {
    const my = id++;
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: my, method, params }) + "\n");
    for (let t = 0; t < 900; t++) {
      if (rep.has(my)) return rep.get(my);
      await sleep(100);
    }
    throw new Error(`person: no reply to ${method}`);
  };
  return {
    async init() {
      await req("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "stand-run-person", version: "0" } });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    },
    async call(name, args) {
      const r = await req("tools/call", { name, arguments: args });
      return { text: (r.result?.content ?? []).map((c) => c.text ?? "").join("\n"), error: !!(r.error || r.result?.isError) };
    },
    close: () => (child.stdin.end(), child.kill()),
  };
}
const seatId = (board, name) => {
  const lines = board.split("\n");
  for (let i = 0; i < lines.length; i++)
    if (lines[i].includes(`:${name} —`))
      for (let j = i + 1; j < i + 8 && j < lines.length; j++) {
        const mm = lines[j].match(/^\s+id ([0-9a-f-]{36})/);
        if (mm) return mm[1];
      }
  return null;
};
const log = () => (existsSync(join(auth, "standings.log")) ? readFileSync(join(auth, "standings.log"), "utf8") : "");
const lastAt = (msgs) => Math.max(0, ...msgs.map((x) => Number(x?.time?.created ?? x?.time?.completed ?? 0)));
const assistantAfter = (msgs, t) => msgs.filter((x) => (x.type ?? x.role) === "assistant" && Number(x?.time?.created ?? 0) > t).length;

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const nameA = `oc-${stamp}.a`;
const nameB = `oc-${stamp}.b`;
const P = stdioBridge();
try {
  await P.init();
  const k = await P.call("iskron_add_karta", {
    realm,
    name: "🧪 Агент OpenCode ночного прогона",
    motivation: "Держит место в сессии OpenCode, чтобы прогон проверил остановку сессии снятием места.",
    manifested_as: "adhikarin",
    epistemic_mode: "pratyakshita",
    ontic_mode: "vartamana",
    volitive_mode: "upeksha",
  });
  const karta = (k.text.match(/\(#(\d+)\)/) || [])[1];
  if (!karta) throw new Error(`karta: ${k.text.slice(0, 200)}`);
  await startServe();
  report.push(`realm ${realm} · karta #${karta} · serve ${server} · model ${providerID}/${modelID}`);
  const board = async () => (await P.call("iskron_channel", { realm, action: "list", karta: `#${karta}` })).text;
  const waitSeat = async (name, ms = 240_000) => {
    for (let t = 0; t < ms; t += 5000) {
      if (seatId(await board(), name)) return true;
      await sleep(5000);
    }
    return false;
  };
  const standText = (name) =>
    `Call the tool iskron_stand with realm="${realm}", karta="#${karta}", name="${name}", model="stand-run". Do not call anything else from iskron.`;

  // A: a seat and a running turn.
  const A = newSession("stop-A");
  prompt(A.id, `${standText(nameA)} Then run the shell command \`sleep 600\` and wait for it to finish. Then answer DONE.`);
  if (!(await waitSeat(nameA))) throw new Error("A: the model did not take the seat — a probe failure, not the bridge's; run again");
  check(true, "A: seat held through the plugin's bridge");
  for (let t = 0; t < 60 && !active().includes(A.id); t++) await sleep(1000);
  await sleep(15_000); // the sleep command is under way
  check(active().includes(A.id), "A: the turn is running before the stop");

  // B: a seat and a session waiting.
  const B = newSession("stop-B");
  prompt(B.id, `${standText(nameB)} Then answer READY and end your turn.`);
  check(await waitSeat(nameB), "B: seat held");
  for (let t = 0; t < 120 && active().includes(B.id); t++) await sleep(1000);
  check(!active().includes(B.id), "B: idle before the stop");

  // The person takes both seats off.
  const brd = await board();
  const tStop = Date.now();
  for (const n of [nameA, nameB])
    await P.call("iskron_channel", { realm, action: "revoke", karta: `#${karta}`, channel: seatId(brd, n), as_person: true });
  await sleep(45_000);
  check(!active().includes(A.id), "A: the running turn is cut", active().join(","));
  check(!active().includes(B.id), "B: not woken by the stop");
  const after = log().split("\n").filter((l) => l.includes(nameA) || l.includes(nameB));
  for (const n of [nameA, nameB]) {
    const own = after.filter((l) => l.includes(n));
    const i = own.findIndex((l) => / stopped .*revoked:person/.test(l));
    check(i !== -1, `${n}: stopped … revoked:person in standings.log`, own[i]);
    check(i !== -1 && !own.slice(i + 1).some((l) => / held /.test(l)), `${n}: no held after the stop`);
  }
  const quietFrom = tStop + 20_000;
  check(assistantAfter(messages(A.id), quietFrom) === 0, "A: no new model turn after the stop");
  check(assistantAfter(messages(B.id), quietFrom) === 0, "B: no new model turn after the stop");
  check(!seatId(await board(), nameA) && !seatId(await board(), nameB), "board: both seats gone");
  for (const [n, id] of [["A", A.id], ["B", B.id]]) {
    check(!inbox(id).some(hasStopWord), `${n}: the stop word does not wait in the session's inbox to wake it`, JSON.stringify(inbox(id)).slice(0, 160));
  }

  // While the seat is off the model sees the stop word in every turn (the plugin's context hook,
  // graph @nks/nks-dev, node #7585) — asked by a human prompt, which a stop does not forbid.
  const askContext =
    'Look at your context for this turn only. If any text there says your iskron seat was taken off or that you are stopped, quote that text verbatim. Otherwise answer exactly NONE. Do not call any tools.';
  const answerOf = async (id, since) => {
    for (let t = 0; t < 120; t++) {
      if (!active().includes(id)) {
        const got = messages(id).filter((x) => (x.type ?? x.role) === "assistant" && Number(x?.time?.created ?? 0) > since);
        if (got.length) return JSON.stringify(got[got.length - 1]);
      }
      await sleep(1000);
    }
    return "";
  };
  const tAsk = Date.now();
  prompt(B.id, askContext);
  const seen = await answerOf(B.id, tAsk);
  check(hasStopWord(seen), "B stopped: the model sees the stop word in its turn", seen.match(/"text":"([^"]{0,140})/)?.[1]);
  check(!inbox(B.id).some(hasStopWord), "B stopped: still nothing of the plugin waits in the inbox");

  // A plugin reload: the stopped sessions stay stopped.
  await stopServe();
  const tReload = Date.now();
  await startServe();
  await sleep(45_000);
  check(!active().includes(A.id) && !active().includes(B.id), "after a plugin reload: neither session runs");
  check(assistantAfter(messages(A.id), tReload) + assistantAfter(messages(B.id), tReload) === 0, "after a plugin reload: no model turn");
  const heldAfter = log()
    .split("\n")
    .filter((l) => (l.includes(nameA) || l.includes(nameB)) && / held /.test(l) && Date.parse(l.slice(0, 24)) > tReload);
  check(heldAfter.length === 0, "after a plugin reload: no held of the stopped seats", heldAfter.join(" | "));

  // An explicit stand lifts the ban: a word to B's seat reaches B again.
  prompt(B.id, `${standText(nameB)} Then answer READY and end your turn.`);
  const tStand = Date.now();
  check(await waitSeat(nameB), "B: explicit stand takes the name again");
  for (let t = 0; t < 120 && active().includes(B.id); t++) await sleep(1000);
  await sleep(10_000);
  check(!messages(B.id).some((x) => Number(x?.time?.created ?? 0) > tStand && (x.type ?? x.role) !== "assistant" && hasStopWord(x)), "B: no stale stop word after the explicit stand");
  const tAsk2 = Date.now();
  prompt(B.id, askContext);
  const seen2 = await answerOf(B.id, tAsk2);
  check(seen2 !== "" && !hasStopWord(seen2), "B held again: the stop word is gone from the turn's context", seen2.match(/"text":"([^"]{0,140})/)?.[1]);
  const before = messages(B.id).length;
  const sent = await P.call("iskron_channel", {
    realm,
    action: "send",
    karta: `#${karta}`,
    standing: nameB,
    text: "stand-run: reply PONG and end your turn",
    as_person: true,
  });
  check(!sent.error, "person's word to B's seat accepted", sent.text.split("\n")[0]);
  let reached = false;
  for (let t = 0; t < 90 && !reached; t++) {
    reached = messages(B.id).length > before;
    await sleep(2000);
  }
  check(reached, "B: after the explicit stand a word reaches the session again");
  const brd2 = await board();
  if (seatId(brd2, nameB))
    await P.call("iskron_channel", { realm, action: "revoke", karta: `#${karta}`, channel: seatId(brd2, nameB), as_person: true });
} catch (e) {
  report.push(`ERROR ${e.message}`);
  failed++;
} finally {
  P.close();
  await stopServe();
}
process.stdout.write(report.join("\n").split(token).join("<token>") + "\n");
process.stdout.write(`\nrun dir: ${run}${keep ? "" : " (removed)"}\n`);
if (!keep) rmSync(run, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
process.exit(failed ? 1 : 0);
