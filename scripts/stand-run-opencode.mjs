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
// failed, 2 — setup failed. --api URL --person U — the owner's stop order (#7519) on a running
// session's seat and on a satellite's, laid by U through the api's test identity.
// The release batch: the seat's pulse — idle after a turn, busy in it, turn_at at its end, read_at
// when a word went into it (#7529; with --api read from GET /me/channels, else the board's text);
// Esc keeps the seat. Out of the batch: the agent's end (#7493; #473 excluded from the release) —
// a plugin reload returns the seat to the same session without waiting, a deleted session's seat
// goes at once without a stop word, a killed harness's seat stands until the death window and
// then goes; --with-agent-end runs it, --death-ms is then the death window, 20000. With --satellite the
// child session runs on --child-model (default anthropic/claude-opus-5-5) and its .sub-N seat
// carries that model on the board, not the parent's (#7591).
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  const head = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  process.stdout.write(head.slice(0, head.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n");
  process.exit(0);
}
const tokenFile = arg("--token-file");
const URL_ = arg("--url");
const realm = arg("--realm");
const [providerID, modelID] = arg("--model", "anthropic/claude-sonnet-5-5").split("/");
const [childProviderID, childModelID] = arg("--child-model", "anthropic/claude-opus-5-5").split("/");
const withAgentEnd = process.argv.includes("--with-agent-end");
const OUT_AGENT_END = "SKIP вне состава: конец агента (#473 исключён из выпуска) — --with-agent-end включает";
const deathMs = Number(arg("--death-ms", "20000"));
const keep = process.argv.includes("--keep");
const apiArg = arg("--api");
const personArg = arg("--person");
const ackLog = arg("--ack-log", null);
// --bridge / --plugin — another build (a release output), dist/dev by default.
const bridge = arg("--bridge", join(root, "dist/dev/skills/establish-mcp/scripts/iskron.mjs"));
const plugin = arg("--plugin", join(root, "dist/dev/skills/establish-mcp/scripts/opencode-plugin.js"));
const fail = (code, t) => (process.stderr.write(`stand-run-opencode: ${t}\n`), process.exit(code));
if (!tokenFile || !URL_ || !realm) fail(2, "--token-file, --url and --realm are required");
if (process.argv.includes("--death-ms") && !withAgentEnd) fail(2, "--death-ms is for --with-agent-end only");
if (process.argv.includes("--satellite") && childModelID === modelID) fail(2, "--child-model must differ from --model: the satellite's model is told apart by it");
if (!existsSync(bridge) || !existsSync(plugin)) fail(2, "no bridge or plugin build — make build-js, or --bridge/--plugin");
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
// A wire probe of the run's own: every model request body this server sends, one JSON line each —
// the ground truth of what the model was given, apart from what it answers.
const wire = join(run, "wire.jsonl");
writeFileSync(
  join(oc, "plugins/zz-wire-probe.js"),
  `import { appendFileSync } from "node:fs";
export default { id: "stand-run-wire", async setup(ctx) {
  await ctx.session.hook("http.request", async (req) => {
    try { appendFileSync(${JSON.stringify(wire)}, JSON.stringify({ session: String(req.sessionID), kind: req.kind, at: Date.now(), body: await req.request.clone().text() }) + "\\n"); } catch {}
  });
} };
`,
);

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
  ISKRON_BRIDGE_DEATH_MS: String(deathMs),
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
// The order's trace (#7510): accepted on disk and answered before the stop, the outcome after
// the accepted's answer. The bridge's journal <auth>/orders/<id>.json keeps the accepted's time
// (`at`) under the outcome; the stand's /api proxy logs every ack it carries (--ack-log, JSONL
// {t, done, order, state, status}); standings.log stamps the stop and the outcome.
const stampOf = (line) => Date.parse(line.slice(0, 24));
function orderTrace(label, id, authDir, logText) {
  const lines = logText.split("\n").filter((l) => l.includes(`stop order ${id}`));
  const outcome = lines.find((l) => l.includes(`stop order ${id} for `));
  const action = lines.find((l) => !l.includes(`stop order ${id} for `));
  const jf = join(authDir, "orders", `${id}.json`);
  const j = existsSync(jf) ? JSON.parse(readFileSync(jf, "utf8")) : null;
  check(!!j && j.state === "stopped" && typeof j.at === "number", `order (${label}): the journal holds it, stopped, with the accepted's time`, j ? `${j.state} at ${new Date(j.at).toISOString()} acked ${j.acked}` : "no journal entry");
  const acks = ackLog ? (existsSync(ackLog) ? readFileSync(ackLog, "utf8") : "").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((a) => a.order === id) : [];
  const acc = acks.find((a) => a.state === "accepted");
  const out = acks.find((a) => a.state !== "accepted");
  check(!!acc && acc.status < 300, `order (${label}): accepted reached the api`, acc ? `${acc.status} at ${new Date(acc.t).toISOString()}` : `acks: ${JSON.stringify(acks).slice(0, 160)}`);
  check(!!acc && !!out && out.state === "stopped" && out.status < 300 && acc.done <= out.t, `order (${label}): the outcome went after the accepted's answer`, acc && out ? `accepted answered ${new Date(acc.done).toISOString()}, ${out.state} sent ${new Date(out.t).toISOString()}` : "");
  const stopAt = action ? stampOf(action) : outcome ? stampOf(outcome) : NaN;
  check(!!j && stopAt >= j.at, `order (${label}): accepted on disk before the stop`, j && action ? `accepted ${new Date(j.at).toISOString()} · ${action.slice(0, 120)}` : outcome?.slice(0, 140));
  check(!!acc && !!outcome && stampOf(outcome) >= acc.done - 5, `order (${label}): the outcome line after the accepted's answer`, outcome?.slice(0, 60));
}

// The nks api directly: as the person (test identity) or as the plugin's own credential.
async function nks(method, path, { body, asSeat } = {}) {
  const h = { "Content-Type": "application/json", "X-NKS-Realm": realm };
  if (asSeat) h.Authorization = `Bearer ${token}`;
  else Object.assign(h, { "X-Forwarded-User": personArg, "X-Forwarded-User-Pref-Username": personArg });
  const r = await fetch(apiArg.replace(/\/$/, "") + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null;
  try {
    j = await r.json();
  } catch {}
  return { status: r.status, body: j?.data ?? j };
}
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
// An observation that failed is not an empty one: "not woken", "no new turn", "the queue is
// empty" must not pass on an unreadable answer — the read throws and the run fails.
function read(path) {
  const r = api("GET", path);
  if (!r.ok) throw new Error(`GET ${path}: ${r.raw.slice(0, 300)}`);
  return r.data;
}
function listOf(d, what) {
  const l = d?.data ?? d;
  const list = Array.isArray(l) ? l : Array.isArray(l?.items) ? l.items : null;
  if (!list) throw new Error(`${what}: not a list — ${JSON.stringify(d).slice(0, 300)}`);
  return list;
}
const active = () => {
  const d = read("/api/session/active");
  if (!d || typeof d.data !== "object" || d.data === null) throw new Error(`session/active: ${JSON.stringify(d).slice(0, 300)}`);
  return Object.keys(d.data);
};
const messages = (id) => listOf(read(`/api/session/${id}/message?limit=200`), `messages of ${id}`);
const inbox = (id) => listOf(read(`/api/session/${id}/inbox`), `inbox of ${id}`);
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
const daemonLog = () => (existsSync(join(auth, "run/daemon.log")) ? readFileSync(join(auth, "run/daemon.log"), "utf8") : "");
// The seat's lines on the board: its head line up to the next seat's.
const seatBlock = (board, name) => {
  const lines = board.split("\n");
  const i = lines.findIndex((l) => l.includes(`:${name} —`));
  if (i === -1) return [];
  const j = lines.findIndex((l, k) => k > i && / · @[\w.-]+:\S+ —/.test(l));
  return lines.slice(i, j === -1 ? i + 10 : Math.min(j, i + 10));
};
// The seat's pulse (graph @nks/nks-dev, node #7529): with --api the deepest object of
// GET /me/channels carrying `pulse` that names the seat, else the board's text.
function pulseIn(x, key) {
  if (!x || typeof x !== "object") return null;
  for (const v of Object.values(x)) {
    const f = pulseIn(v, key);
    if (f) return f;
  }
  return x.pulse && typeof x.pulse === "object" && JSON.stringify(x).includes(key) ? x.pulse : null;
}
function pulseText(block) {
  const t = block.join("\n");
  const j = t.match(/pulse[=:]\s*(\{[^\n]*?\})/);
  if (j)
    try {
      return JSON.parse(j[1]);
    } catch {}
  const s = t.match(/\bstate[=:]\s*(\w+)/);
  if (!s) return null;
  const out = { state: s[1] };
  const p = t.match(/\bpending[=:]\s*(\d+)/);
  if (p) out.pending = Number(p[1]);
  for (const k of ["turn_at", "read_at", "cycle_at"]) {
    const m = t.match(new RegExp(`\\b${k}[=:]\\s*([^\\s,·]+)`));
    if (m) out[k] = m[1];
  }
  return out;
}
const hasStop = (name, text) => text.split("\n").some((l) => l.includes(name) && / stopped /.test(l));
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
  // The plugin's bridge lists the graph tools a moment after serve answers: prompting before
  // that hands the model a catalog without iskron_stand (a probe failure, not the bridge's).
  const toolsUp = () => (existsSync(join(run, "serve.log")) ? readFileSync(join(run, "serve.log"), "utf8") : "");
  for (let t = 0; t < 120 && !/тулов в сессии: \d+|tools in the session: \d+/.test(toolsUp()); t++) await sleep(500);
  await sleep(10_000); // the reload of the tool list lands after the plugin says so
  report.push(`realm ${realm} · karta #${karta} · serve ${server} · model ${providerID}/${modelID}`);
  // a refused read is not an empty board: "both seats gone" must not pass on it
  const board = async () => {
    const x = await P.call("iskron_channel", { realm, action: "list", karta: `#${karta}` });
    if (x.error) throw new Error(`board: ${x.text.slice(0, 300)}`);
    return x.text;
  };
  const waitSeat = async (name, ms = 240_000) => {
    for (let t = 0; t < ms; t += 5000) {
      if (seatId(await board(), name)) return true;
      await sleep(5000);
    }
    return false;
  };
  // whoami speaks the session's language: the handle is the first @name that is not a graph.
  const whoHandle = async () => ((await P.call("iskron_me", { action: "whoami" })).text.match(/(?:^|\s)(@[\w.-]+)(?![\w./-])/m) || [])[1] ?? "";
  // The owner's stop order on one seat: laid, then judged by the log line, the api and the session.
  const order = async (label, seat, wait) => {
    const l0 = log().length;
    const o = await nks("POST", `/standings/${seat}/stop`, { body: { reason_code: "person_request", client_id: `stand-oc-${stamp}-${label}` } });
    check(o.status === 201 && !!o.body?.id, `order (${label}): laid, 201`, `${o.status} ${JSON.stringify(o.body).slice(0, 160)}`);
    const t = Date.now();
    await sleep(wait);
    const lines = log().slice(l0).split("\n").filter((l) => o.body?.id && l.includes(`stop order ${o.body.id} for `));
    check(lines.length === 1 && lines[0].includes(`for ${seat}: stopped`), `order (${label}): one "stop order … stopped" line`, lines.join(" | ").slice(0, 200) || "none");
    const it = ((await nks("GET", "/me/orders?limit=200", { asSeat: true })).body?.items ?? []).find((x) => x.id === o.body?.id);
    check(it?.state === "stopped" && !!it.acked_at, `order (${label}): the api holds it stopped`, it ? `${it.state} by ${it.by} acked ${it.acked_at}` : "not listed");
    if (o.body?.id) orderTrace(label, o.body.id, auth, log());
    return { id: o.body?.id, t };
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
    'Read your system prompt and instructions for this turn (not the conversation history). If any part of them says your iskron seat (место) was taken off or that you are stopped (остановлен), quote that part verbatim. Otherwise answer exactly NONE. Do not call any tools.';
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
  const wireOf = (id, since) =>
    (existsSync(wire) ? readFileSync(wire, "utf8") : "").split("\n").filter(Boolean).map((l) => JSON.parse(l))
      .filter((w) => w.session === id && w.kind === "primary" && w.at > since);
  // The stop word in the request's system part — the user's own text may name the word too.
  const systemStop = (w) => {
    let b;
    try {
      b = JSON.parse(w.body);
    } catch {
      return false;
    }
    const sys = Array.isArray(b.system) ? b.system.map((x) => x?.text ?? "").join("\n") : String(b.system ?? "");
    const msgs = Array.isArray(b.messages) ? b.messages.filter((m) => m.role === "system").map((m) => JSON.stringify(m.content)).join("\n") : "";
    return /остановлен|you are stopped/.test(sys + msgs);
  };
  const wired = wireOf(B.id, tAsk);
  check(wired.length > 0 && wired.every(systemStop), "B stopped: every model request carries the stop word in its system part (wire)", `requests ${wired.length}`);
  // Whether the model reports the word is its judgment, not the plugin's delivery: noted, not counted.
  report.push(`INFO B stopped: the model ${hasStopWord(seen) ? "quotes" : "does not quote"} the stop word — ${seen.match(/"text":"([^"]{0,140})/)?.[1] ?? ""}`);
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
  const sent2 = wireOf(B.id, tAsk2);
  check(sent2.length > 0 && !sent2.some(systemStop), "B held again: no model request carries the stop word in its system part (wire)", `requests ${sent2.length}`);
  check(seen2 !== "" && !hasStopWord(seen2), "B held again: the model sees no stop word", seen2.match(/"text":"([^"]{0,140})/)?.[1]);
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

  // The release batch on one session L: its pulse (graph @nks/nks-dev, node #7529), then its end
  // (#7493) — Esc, a plugin reload, a killed harness; a session D for the deletion.
  const pulseOf = async (name) => {
    const brd = await board();
    if (!apiArg) return pulseText(seatBlock(brd, name));
    return pulseIn((await nks("GET", "/me/channels", { asSeat: true })).body, seatId(brd, name) ?? `:${name}`);
  };
  const waitPulse = async (name, ok, ms = 60_000) => {
    let p = null;
    for (let t = 0; t < ms; t += 5000) {
      p = await pulseOf(name);
      if (ok(p)) return p;
      await sleep(5000);
    }
    return p;
  };
  const idle = async (id, s = 120) => {
    for (let t = 0; t < s && active().includes(id); t++) await sleep(1000);
  };
  const nameL = `oc-${stamp}.l`;
  const L = newSession("batch-L");
  prompt(L.id, `${standText(nameL)} Then answer READY and end your turn.`);
  if (!(await waitSeat(nameL))) throw new Error("L: the model did not take the seat — a probe failure; run again");
  await idle(L.id);
  const p0 = await waitPulse(nameL, (p) => p?.state === "idle" && typeof p.pending === "number");
  check(p0?.state === "idle" && typeof p0.pending === "number", `pulse: the seat idle with pending after its turn (${apiArg ? "GET /me/channels" : "board text"})`, JSON.stringify(p0));
  const tTurn = Date.now();
  prompt(L.id, "Run the shell command `sleep 90` and wait for it to finish. Then answer DONE and end your turn. Do not call anything from iskron.");
  const p1 = await waitPulse(nameL, (p) => p?.state === "busy");
  check(p1?.state === "busy", "pulse: busy during the turn", JSON.stringify(p1));
  const tWord = Date.now();
  const w = await P.call("iskron_channel", { realm, action: "send", karta: `#${karta}`, standing: nameL, text: "stand-run: a word into the running turn — no answer needed", as_person: true });
  check(!w.error, "pulse: a word to the seat during the turn accepted", w.text.split("\n")[0]);
  await idle(L.id, 180);
  const p2 = await waitPulse(nameL, (p) => p?.state === "idle" && Date.parse(p.turn_at) >= tTurn);
  check(p2?.state === "idle" && Date.parse(p2.turn_at) >= tTurn, "pulse: idle after the turn, turn_at at its end", JSON.stringify(p2));
  check(Date.parse(p2?.read_at) >= tWord, "pulse: read_at — the word went into the turn", p2?.read_at);

  // Esc: an interrupted turn keeps the seat; the pulse names it interrupted.
  await idle(L.id, 180);
  const lE = log().length;
  prompt(L.id, "Run the shell command `sleep 600` and wait for it to finish. Then answer DONE. Do not call anything from iskron.");
  for (let t = 0; t < 60 && !active().includes(L.id); t++) await sleep(1000);
  await sleep(10_000);
  const esc = api("POST", `/api/session/${L.id}/interrupt`);
  await idle(L.id, 15);
  check(!active().includes(L.id), "Esc: the turn is interrupted", esc.raw.slice(0, 160));
  await sleep(deathMs + 10_000);
  check(!!seatId(await board(), nameL) && !hasStop(nameL, log().slice(lE)), "Esc: the seat stands past the death window, no stop", log().slice(lE).split("\n").filter((l) => l.includes(nameL)).join(" | ").slice(0, 200));
  const pE = await pulseOf(nameL);
  check(pE?.state === "interrupted", "pulse: interrupted after Esc", JSON.stringify(pE));

  // The agent's end — out of the batch unless --with-agent-end: #473 is excluded from the release.
  if (withAgentEnd) {
    // A plugin reload is an announced absence: the same session holds its seat again without
    // waiting, the seat stands past the death window.
    const lR = log().length;
    await stopServe();
    const tR = Date.now();
    await startServe();
    let back = false;
    for (let t = 0; t < 60 && !back; t++) {
      await sleep(1000);
      back = log().slice(lR).split("\n").some((l) => l.includes(nameL) && /\b(held|resumed)\b/.test(l));
    }
    check(back, "reload: the same session holds its seat again without waiting", `${Math.round((Date.now() - tR) / 1000)} s · ${log().slice(lR).split("\n").filter((l) => l.includes(nameL)).join(" | ").slice(0, 160)}`);
    await sleep(deathMs + 10_000);
    const afterR = log().slice(lR).split("\n").filter((l) => l.includes(nameL));
    check(!!seatId(await board(), nameL), "reload: the seat stands past the death window");
    check(!afterR.some((l) => / (stopped|released) /.test(l)), "reload: the seat neither stopped nor released", afterR.join(" | ").slice(0, 200));

    // A deleted session: its seat goes at once (its bridge's own revoke), no stop word.
    const nameD = `oc-${stamp}.d`;
    const D = newSession("end-D");
    prompt(D.id, `${standText(nameD)} Then answer READY and end your turn.`);
    if (!(await waitSeat(nameD))) throw new Error("D: the model did not take the seat — a probe failure; run again");
    await idle(D.id);
    const lD = log().length;
    const tD = Date.now();
    const del = api("DELETE", `/api/session/${D.id}`);
    let goneD = false;
    while (!goneD && Date.now() - tD < deathMs / 2) {
      await sleep(2000);
      goneD = !seatId(await board(), nameD);
    }
    check(goneD, `end: a deleted session's seat goes at once (before ${deathMs / 2} ms)`, `${Math.round((Date.now() - tD) / 1000)} s · ${del.raw.slice(0, 80)}`);
    check(!hasStop(nameD, log().slice(lD)), "end: no stop word on a deleted session (standings.log)", log().slice(lD).split("\n").filter((l) => l.includes(nameD)).join(" | ").slice(0, 200));

    // A harness killed without a mark: L's seat stands until the death window, then goes.
    await idle(L.id, 180);
    const dK = daemonLog().length;
    const lK = log().length;
    const killed = new Promise((r) => serve.once("exit", r));
    serve.kill("SIGKILL");
    await Promise.race([killed, sleep(10_000)]);
    delete env.OPENCODE_PASSWORD;
    await sleep(deathMs / 2);
    check(!!seatId(await board(), nameL), `end: before the death window (${deathMs} ms) the killed harness's seat stands`);
    await sleep(deathMs / 2 + 20_000);
    check(!seatId(await board(), nameL), "end: after the death window the killed harness's seat is gone");
    const died = daemonLog().slice(dK).split("\n").find((l) => /without an announced absence — closing its seats/.test(l));
    check(!!died, "end: the daemon closes it as a death (daemon.log)", died?.slice(0, 200) ?? "none");
    check(!hasStop(nameL, log().slice(lK)), "end: no stop on a death (standings.log)");
    await startServe();
    await sleep(15_000); // the plugin's tool list
  } else report.push(OUT_AGENT_END);

  // The satellite layer (graph @nks/nks-dev, node #7505): a child session stands as the root's
  // satellite; the launcher's revoke takes the satellite seat off on the server, and a word to
  // the ended satellite does not wake its session.
  if (process.argv.includes("--satellite")) {
    const handle = await whoHandle();
    const nameR = `oc-${stamp}.r`;
    const Rs = newSession("sat-root");
    prompt(Rs.id, `${standText(nameR)} Then answer READY and end your turn.`);
    if (!(await waitSeat(nameR))) throw new Error("root: the model did not take the seat — a probe failure");
    for (let t = 0; t < 120 && active().includes(Rs.id); t++) await sleep(1000);
    const C = api("POST", "/api/session", { title: "sat-child", parentID: Rs.id, location: { directory: cwd }, model: { providerID: childProviderID, id: childModelID } });
    const Cs = C.data?.data ?? C.data;
    if (!Cs?.id) throw new Error(`child create: ${C.raw.slice(0, 200)}`);
    prompt(Cs.id, `Call the tool iskron_stand with realm="${realm}", karta="#${karta}", satellite_of="${handle}:${nameR}". Do not call anything else from iskron. Then answer READY and end your turn.`);
    let sub = null;
    for (let t = 0; t < 48 && !sub; t++) {
      sub = ((await board()).match(new RegExp(`:(${nameR.replace(/\./g, "\\.")}\\.sub-\\d+) —`)) || [])[1] ?? null;
      if (!sub) await sleep(5000);
    }
    check(!!sub, "satellite: the child stands as the root's satellite", sub);
    if (sub) {
      for (let t = 0; t < 120 && active().includes(Cs.id); t++) await sleep(1000);
      // The satellite's model (#7591): the child session's, from the harness — not the parent's.
      const blk = seatBlock(await board(), sub).join("\n");
      check(blk.includes(childModelID) && !blk.includes(modelID), `satellite: ${sub} carries the child's model ${childModelID}, not the parent's ${modelID}`, blk.replace(/\n\s*/g, " | ").slice(0, 200));
      const tRev = Date.now();
      prompt(Rs.id, `Call the tool iskron_channel with realm="${realm}", action="revoke", karta="#${karta}", standing="${sub}". Do not call anything else from iskron. Then answer DONE and end your turn.`);
      let gone = false;
      for (let t = 0; t < 24 && !gone; t++) {
        await sleep(5000);
        gone = !seatId(await board(), sub);
      }
      check(gone, "satellite: the launcher's revoke takes the satellite seat off on the server");
      for (let t = 0; t < 120 && active().includes(Rs.id); t++) await sleep(1000);
      // What the launcher's model is told (graph @nks/nks-dev, node #7599): no false «not taken
      // off», and no revoke call for another seat to follow.
      const told = JSON.stringify(messages(Rs.id).filter((x) => Number(x?.time?.created ?? 0) >= tRev));
      check(!/НЕ снято|NOT taken off|not taken off/.test(told), "satellite: the launcher is not told the seat still hangs");
      check(!/channel=\\*"[0-9a-f-]{36}/.test(told), "satellite: the launcher's answer carries no revoke call for another seat");
      for (let t = 0; t < 120 && active().includes(Rs.id); t++) await sleep(1000);
      const word = await P.call("iskron_channel", { realm, action: "send", karta: `#${karta}`, standing: sub, text: "stand-run: reply PONG", as_person: true });
      report.push(`INFO word to the ended satellite: ${word.error ? "refused" : "accepted"} — ${word.text.split("\n")[0].slice(0, 140)}`);
      await sleep(30_000);
      check(!active().includes(Cs.id) && assistantAfter(messages(Cs.id), tRev + 20_000) === 0, "satellite: the ended child session does not run again");
    }
    const brd3 = await board();
    if (seatId(brd3, nameR)) await P.call("iskron_channel", { realm, action: "revoke", karta: `#${karta}`, channel: seatId(brd3, nameR), as_person: true });
  }
  // The owner's stop order (#7519): a running session's seat — its turn cut, the stop frame never
  // the session's; a satellite's seat — the child ends, the root's seat holds.
  if (apiArg && personArg) {
    const nameO = `oc-${stamp}.o`;
    const O = newSession("order-O");
    prompt(O.id, `${standText(nameO)} Then run the shell command \`sleep 600\` and wait for it to finish. Then answer DONE.`);
    if (!(await waitSeat(nameO))) throw new Error("O: the model did not take the seat — a probe failure; run again");
    for (let t = 0; t < 60 && !active().includes(O.id); t++) await sleep(1000);
    await sleep(15_000);
    check(active().includes(O.id), "order: the turn is running before it");
    const o = await order("running", seatId(await board(), nameO), 45_000);
    check(!active().includes(O.id), "order (running): the turn is cut", active().join(","));
    check(!seatId(await board(), nameO), "order (running): the seat is gone");
    const seen = JSON.stringify(messages(O.id));
    check(!/"type":\s*"stop"/.test(seen) && !(o.id && seen.includes(o.id)), "order (running): the stop frame is not in the session");
    check(assistantAfter(messages(O.id), o.t + 20_000) === 0, "order (running): no new model turn after it");

    const handle = await whoHandle();
    const nameS = `oc-${stamp}.s`;
    const Ss = newSession("order-root");
    prompt(Ss.id, `${standText(nameS)} Then answer READY and end your turn.`);
    if (!(await waitSeat(nameS))) throw new Error("order root: the model did not take the seat — a probe failure");
    for (let t = 0; t < 120 && active().includes(Ss.id); t++) await sleep(1000);
    const C = api("POST", "/api/session", { title: "order-child", parentID: Ss.id, location: { directory: cwd }, model: { providerID, id: modelID } });
    const Cs = C.data?.data ?? C.data;
    if (!Cs?.id) throw new Error(`order child create: ${C.raw.slice(0, 200)}`);
    prompt(Cs.id, `Call the tool iskron_stand with realm="${realm}", karta="#${karta}", satellite_of="${handle}:${nameS}". Do not call anything else from iskron. Then answer READY and end your turn.`);
    let sub = null;
    for (let t = 0; t < 48 && !sub; t++) {
      sub = ((await board()).match(new RegExp(`:(${nameS.replace(/\./g, "\\.")}\\.sub-\\d+) —`)) || [])[1] ?? null;
      if (!sub) await sleep(5000);
    }
    check(!!sub, "order: the child stands as a satellite", sub);
    if (sub) {
      for (let t = 0; t < 120 && active().includes(Cs.id); t++) await sleep(1000);
      const os = await order("satellite", seatId(await board(), sub), 45_000);
      check(!seatId(await board(), sub), "order (satellite): the satellite seat is gone");
      check(!!seatId(await board(), nameS), "order (satellite): the root's seat holds");
      check(!active().includes(Cs.id) && assistantAfter(messages(Cs.id), os.t + 20_000) === 0, "order (satellite): the child does not run again");
      const seenC = JSON.stringify(messages(Cs.id));
      check(!/"type":\s*"stop"/.test(seenC) && !(os.id && seenC.includes(os.id)), "order (satellite): the stop frame is not in the child session");
    }
    const brd4 = await board();
    if (seatId(brd4, nameS)) await P.call("iskron_channel", { realm, action: "revoke", karta: `#${karta}`, channel: seatId(brd4, nameS), as_person: true });
  } else report.push("SKIP stop order — needs --api and --person");
} catch (e) {
  report.push(`ERROR ${e.message}`);
  failed++;
} finally {
  P.close();
  await stopServe();
}
process.stdout.write(report.join("\n").split(token).join("<token>") + "\n");
process.stdout.write(`\nrun dir: ${run}${keep ? "" : " (removed)"}\n`);
// The machine daemons of this run's auth dirs outlive their sessions by an idle window and
// would write into the run dir after its removal: put them down first.
for (const d of [auth, join(run, "auth-person")]) spawnSync("pkill", ["-f", `daemon --auth-dir ${d}( |$)`]);
await new Promise((r) => setTimeout(r, 1500));
if (!keep) rmSync(run, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
process.exit(failed ? 1 : 0);
