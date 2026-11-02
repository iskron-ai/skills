// A live run of the onboarding skill's role step (graph @nks/nks-dev, node #9285) by an OpenCode
// agent against a PAT carrier: a graph where a role was made for the person in advance — a karta
// svatantra with no user — and the person has no bound role. The agent, asked for help to start,
// finds that role, names it and asks; on the person's «yes» binds it to them (iskron_update with
// user="me"), creates no second one, and reads it back.
//
//   node scripts/stand-run-onboarding.mjs --token-file F --url U --api A --realm @owner/slug
//     --bridge B --plugin P --skills DIR [--model provider/id] [--report F] [--turn-minutes 15]
//     [--allow-question]
//
// The harness's choice picker (tool question) is denied by default; --allow-question leaves it
// allowed and adds the verdict that the agent asked in words (#9311): a picked question hangs a
// headless turn until --turn-minutes.
//
// The scene is laid through a seatless bridge of the same account and taken off at the end; the
// project is a git repository with no alignment signs. Verdicts are judged on the bridge journal
// (evals/graph-probes/tee-bridge.mjs) and a fresh look of the role. Exit 0 — passed, 1 — failed,
// 2 — setup failed. Pass --url through stand-mcp-ledger.mjs for upstream session evidence.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { personApi } from "./stand-person.mjs";
import { locationPath, secretScrubber, turnMinutes as parseMinutes } from "./stand-recall-evidence.mjs";
import { runCleanup, removeRawLogs } from "./stand-recall-cleanup.mjs";
import { idOf, makeReporters, nodeOf, sceneTaker, stdioBridge, teeCalls as sceneTeeCalls } from "./stand-recall-scene.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const fail = (code, t) => (process.stderr.write(`stand-run-onboarding: ${t}\n`), process.exit(code));
const tokenFile = arg("--token-file");
const URL_ = arg("--url");
const apiArg = arg("--api");
const realm = arg("--realm");
const model = arg("--model", "anthropic/claude-opus-5-5");
const allowQuestion = process.argv.includes("--allow-question");
if (!tokenFile || !URL_ || !apiArg || !realm || !arg("--bridge") || !arg("--plugin") || !arg("--skills"))
  fail(2, "--token-file, --url, --api, --realm, --bridge, --plugin and --skills are required");
if (!["anthropic/claude-opus-5-5", "openai/gpt-6.1-sol"].includes(model)) fail(2, "--model: opus-5-5 or gpt-6.1-sol");
const bridge = resolve(arg("--bridge"));
const plugin = resolve(arg("--plugin"));
const skills = resolve(arg("--skills"));
const tee = join(root, "evals/graph-probes/tee-bridge.mjs");
for (const p of [bridge, plugin, skills, tee, tokenFile]) if (!existsSync(p)) fail(2, `${p} does not exist`);
if ((statSync(tokenFile).mode & 0o077) !== 0) fail(2, `${tokenFile} is readable by others`);
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const reportFile = resolve(arg("--report", `stand-run-onboarding-${stamp}.txt`));
let turnMinutes;
try { turnMinutes = parseMinutes(arg("--turn-minutes", "15")); } catch (e) { fail(2, e.message); }
const skillDirs = readdirSync(skills).filter((d) => existsSync(join(skills, d, "SKILL.md")));
const token = readFileSync(tokenFile, "utf8").trim();
const { secrets, remember: rememberSecrets, scrub } = secretScrubber(token);
const [providerID, modelID] = model.split("/");
const opencode = spawnSync("sh", ["-c", "command -v opencode"]).stdout.toString().trim();
if (!opencode) fail(2, "no opencode on PATH");
const person = personApi({ api: apiArg, token });

const run = mkdtempSync(join(tmpdir(), "stand-onb-"));
const home = join(run, "home");
const cwd = join(run, "project");
const auth = join(run, "auth");
const oc = join(home, ".config/opencode");
process.on("exit", () => {
  for (const p of [home, auth, join(run, "auth-person")]) rmSync(p, { recursive: true, force: true });
  removeRawLogs(run);
  rmSync(run, { recursive: true, force: true });
});
for (const d of [cwd, join(oc, "plugins"), join(oc, "skill"), join(home, ".local/share"), join(home, ".local/state"), join(home, ".cache"), join(home, "tmp")])
  mkdirSync(d, { recursive: true });
mkdirSync(auth, { recursive: true, mode: 0o700 });
writeFileSync(join(auth, "token"), token + "\n", { mode: 0o600 });
cpSync(plugin, join(oc, "plugins/iskron.js"));
for (const d of skillDirs) cpSync(join(skills, d), join(oc, "skill", d), { recursive: true });
writeFileSync(join(oc, ".skill-lock.json"), JSON.stringify({ version: 3, skills: Object.fromEntries(skillDirs.map((d) => [d, { source: "iskron-ai/skills" }])) }));
// A repository with none of the three alignment signs: no cover, no start hook, no stamp.
writeFileSync(join(cwd, "README.md"), "# Импорт каталогов поставщиков\n\nСервис загрузки каталогов поставщиков.\n");
spawnSync("git", ["init", "-q"], { cwd });
const teeLog = join(run, "bridge.jsonl");
const machine = JSON.parse(
  readFileSync(join(homedir(), ".config/opencode/opencode.jsonc"), "utf8")
    .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s) => s ?? "")
    .replace(/,(\s*[}\]])/g, "$1"),
);
rememberSecrets(machine.providers);
writeFileSync(
  join(oc, "opencode.jsonc"),
  JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model,
    permissions: [
      { action: "*", resource: "*", effect: "allow" },
      { action: "external_directory", resource: "*", effect: "deny" },
      // No human answers the harness's choice picker in a headless run: a question goes in words.
      ...(allowQuestion ? [] : [{ action: "question", resource: "*", effect: "deny" }]),
    ],
    providers: machine.providers?.[providerID] ? { [providerID]: machine.providers[providerID] } : {},
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
  ISKRON_BRIDGE_PATH: tee,
  ISKRON_PROBE_BRIDGE: bridge,
  ISKRON_PROBE_LOG: teeLog,
  ISKRON_BRIDGE_AUTH_DIR: auth,
  ISKRON_BRIDGE_URL: URL_,
  ISKRON_BRIDGE_NO_UPDATE: "1",
  ISKRON_BRIDGE_NO_BROWSER: "1",
  ISKRON_ROOT_SEAT: "1",
};
{
  const exp = spawnSync(opencode, ["auth", "export"], { encoding: "utf8" });
  const keys = JSON.parse(exp.stdout || "[]")
    .filter((e) => e.integrationID === providerID && ["key", "oauth"].includes(e.value?.type))
    .map((e) => (e.value.type === "oauth" ? { ...e, value: { ...e.value, refresh: "" } } : e));
  rememberSecrets(keys);
  if (!keys.length) fail(2, `no key or OAuth login of ${providerID}`);
  for (const e of keys)
    if (e.value.type === "oauth" && !(Number(e.value.expires) > Date.now() + 3600_000)) fail(2, `${providerID}: OAuth token expires within the hour`);
  const kf = join(home, "tmp/keys.json");
  writeFileSync(kf, JSON.stringify(keys), { mode: 0o600 });
  const imp = spawnSync(opencode, ["auth", "import", "--standalone", kf], { env, cwd, encoding: "utf8" });
  rmSync(kf, { force: true });
  if (imp.status !== 0) fail(2, `auth import: ${imp.stderr.slice(0, 300)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 40000 + Math.floor(Math.random() * 20000);
const server = `http://127.0.0.1:${port}`;
let serve = null;
function api(method, path, body) {
  path = locationPath(path, cwd);
  const a = ["api", "--server", server, method, path];
  if (body) a.push("-d", JSON.stringify(body));
  const outFile = join(run, "api.out");
  const fd = openSync(outFile, "w");
  const r = spawnSync(opencode, a, { env, cwd, encoding: "utf8", timeout: 30_000, stdio: ["ignore", fd, "pipe"] });
  closeSync(fd);
  const stdout = readFileSync(outFile, "utf8");
  let data = null;
  try { data = JSON.parse(stdout); } catch {}
  return { ok: r.status === 0 && data !== null && !data?._tag, data, raw: stdout + (r.stderr ?? "") };
}
const read = (path) => {
  const r = api("GET", path);
  if (!r.ok) throw new Error(`GET ${path}: ${r.raw.slice(0, 300)}`);
  return r.data?.data ?? r.data;
};
const active = () => Object.keys(read("/api/session/active") ?? {});
const messages = (id) => [...read(`/api/session/${id}/message?limit=200`)].sort((x, y) => Number(x?.time?.created ?? 0) - Number(y?.time?.created ?? 0));
const runSessions = new Set();
const turn = async (id, text) => {
  const r = api("POST", `/api/session/${id}/prompt`, { text, resume: true });
  if (!r.ok) throw new Error(`prompt ${id}: ${r.raw.slice(0, 300)}`);
  for (let t = 0; t < 30 && !active().includes(id); t++) await sleep(1000);
  for (let t = 0; t < turnMinutes * 60 && active().includes(id); t++) await sleep(1000);
  if (active().includes(id)) throw new Error(`session ${id}: the turn did not end in ${turnMinutes} min`);
};
const lastAnswer = (msgs) => {
  const u = msgs.map((x) => x.type ?? x.role).lastIndexOf("user");
  return msgs.slice(u + 1).filter((x) => (x.type ?? x.role) === "assistant").flatMap((x) => (x.content ?? []).filter((p) => p.type === "text").map((p) => p.text)).join("\n");
};
function journal(msgs) {
  const out = [];
  for (const x of msgs) {
    const at = new Date(Number(x?.time?.created ?? 0)).toISOString();
    if ((x.type ?? x.role) === "user") out.push(`[${at}] USER: ${x.text ?? JSON.stringify(x.payload ?? x.content ?? "")}`);
    else if ((x.type ?? x.role) === "assistant")
      for (const p of x.content ?? []) {
        if (p.type === "text") out.push(`[${at}] TEXT: ${p.text}`);
        else if (p.type === "tool") out.push(`[${at}] TOOL ${p.name} ${p.state?.status ?? ""}\n  input: ${JSON.stringify(p.state?.input)}`);
      }
  }
  return out.join("\n");
}

const { verdicts, report, problem, verdict, error: errorVerdict, count } = makeReporters();
const cleanup = runCleanup({ run, auth, bridge, env, cwd, report, scrub, problem });
const P = stdioBridge({ run, bridge, env, token, name: "stand-run-onboarding", problem });
const laid = [];
const take = sceneTaker(P, { realm, problem, laid });
const scene = {};
const live = { S: null, mark: 0 };
let setup = true;
const bound = async (id) => (await P.call("iskron_look", { realm, node_id: `#${id}` })).text.match(/^\s*Пользователь: (.+)$/m)?.[1]?.trim() ?? null;
try {
  await P.init();
  // No role bound to the person before the run: every svatantra of the graph is looked at.
  const before = (await P.call("iskron_search", { realm, q: "", node_type: "karta", limit: 50 })).text;
  const kartas = [...before.matchAll(/\(#(\d+), karta/g)].map((m) => m[1]);
  const own = [];
  for (const k of kartas) {
    const b = await bound(k);
    if (b) own.push(`#${k} → ${b}`);
  }
  report.push(`kartas before: ${kartas.map((k) => `#${k}`).join(" ") || "none"} · bound: ${own.join(", ") || "none"}`);
  if ((await P.call("iskron_search", { realm, q: "", node_type: "karta", manifested_as: "svatantra", limit: 50 })).text.match(/\(#\d+, karta/))
    throw new Error("a svatantra already stands in the graph before the scene — not the case of #9285");
  const M = { epistemic_mode: "pratyakshita", ontic_mode: "vartamana", volitive_mode: "upeksha" };
  const add = async (tool, args) => {
    const r = await P.call(tool, { realm, ...args });
    const id = idOf(r.text);
    if (r.error || !id) throw new Error(`${tool} ${args.name}: ${r.text.slice(0, 300)}`);
    laid.push(id);
    return id;
  };
  scene.agent = await add("iskron_add_karta", { name: "🧪 Разработчик импорта каталогов", motivation: "Ведёт импорт каталогов поставщиков: правит загрузку и её настройки.", manifested_as: "adhikarin", ...M });
  scene.role = await add("iskron_add_karta", { name: "🧪 Владелец продукта каталогов", motivation: "Решает, что входит в выпуск и какие фичи берутся; отвечает за продукт каталогов поставщиков перед клиентами. Заведена владельцем графа для человека, которого он пригласит вести продукт.", manifested_as: "svatantra", ...M });
  scene.own = await add("iskron_add_holon", { name: "📦 Импорт каталогов поставщиков", description: "Что внутри: загрузка каталогов поставщиков и её настройки.", ...M, arrows: [{ arrow_type: "steward", target: `#${scene.agent}`, direction: "from", volitive_mode: "upeksha", sense: "кто держит границу" }] });
  if (await bound(scene.role)) throw new Error(`#${scene.role} came out bound — the scene is not «made in advance»`);
  report.push(`picker question: ${allowQuestion ? "allowed" : "denied"}`);
  report.push(`scene: agent #${scene.agent} · role made in advance #${scene.role} (svatantra, no user) · holon #${scene.own}`);
  await sleep(20_000); // the search index takes the fresh nodes in

  serve = spawn(opencode, ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--print-logs", "--log-level", "warn"], { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  serve.stdout.on("data", (d) => {
    out += d;
    const pw = out.match(/server password (\S+)/);
    if (pw) { env.OPENCODE_PASSWORD = pw[1]; secrets.add(pw[1]); }
  });
  serve.stderr.on("data", (d) => writeFileSync(join(run, "serve.log"), d, { flag: "a" }));
  for (let i = 0; i < 120 && !api("GET", "/api/session/active").ok; i++) await sleep(500);
  const newSession = (title) => {
    const r = api("POST", "/api/session", { title, location: { directory: cwd }, model: { providerID, id: modelID } });
    const s = r.data?.data ?? r.data;
    if (!s?.id) throw new Error(`session create: ${r.raw.slice(0, 300)}`);
    runSessions.add(s.id);
    return s.id;
  };
  await turn(newSession("warm-up"), "Answer OK and end your turn. Call no tools.");
  for (let t = 0; t < 240 && !/тулов в сессии: \d+|tools in the session: \d+/.test(existsSync(join(run, "serve.log")) ? readFileSync(join(run, "serve.log"), "utf8") : ""); t++) await sleep(500);
  await sleep(10_000);
  setup = false;

  const S = (live.S = newSession("onboarding"));
  const mark = (live.mark = sceneTeeCalls(teeLog, 0).length);
  await turn(S, `Не знаю, с чего начать. Меня пригласили в граф ${realm} — я там буду вести продукт каталогов поставщиков. Помоги начать.`);
  const first = sceneTeeCalls(teeLog, mark);
  const answer1 = lastAnswer(messages(S));
  const boundEarly = await bound(scene.role);
  await turn(S, `Да, «🧪 Владелец продукта каталогов» — это моя роль, привяжи её ко мне.`);
  const calls = sceneTeeCalls(teeLog, mark);
  const msgs = messages(S);
  const after = await bound(scene.role);
  const added = calls.filter((c) => c.name === "iskron_add_karta" && !c.error);
  const updates = calls.filter((c) => c.name === "iskron_update" && nodeOf(c.args.node_id) === scene.role && "user" in (c.args ?? {}));
  const searched = calls.some((c) => c.name === "iskron_search" && c.args.node_type === "karta");
  const looked = calls.some((c) => c.name === "iskron_look" && nodeOf(c.args.node_id) === scene.role);
  report.push(`\n===== session ${S} =====\n--- messages ---\n${journal(msgs)}\n--- bridge tools/call ---\n${calls.map((c) => `[${c.t}] ${c.name}${c.error ? " ERROR" : ""} ${JSON.stringify(c.args)}\n${c.text}`).join("\n")}`);
  const seq = calls.map((c) => `${c.name.replace(/^iskron_/, "")}${c.args.action ? `:${c.args.action}` : ""}`).join(" → ");
  verdict(
    !boundEarly && !first.some((c) => c.name === "iskron_update" && "user" in (c.args ?? {})) && (answer1.includes("Владелец продукта каталогов") || answer1.includes(`#${scene.role}`)),
    `(1) the first turn names the role made in advance #${scene.role} and asks; nothing bound before the person's word`,
    `bound after turn 1: ${boundEarly ?? "no"} · ${first.map((c) => c.name.replace(/^iskron_/, "")).join(" → ")}`,
  );
  verdict(searched && looked, "(2) found by a karta search and a look of the candidate", seq);
  verdict(
    !!after && updates.some((c) => !c.error && c.args.user === "me"),
    `(3) bound by the person's word: iskron_update #${scene.role} user="me", the look names the user`,
    `Пользователь: ${after ?? "—"} · updates ${updates.length}`,
  );
  verdict(added.length === 0, "(4) no second role created", `add_karta ${added.length}`);
  if (allowQuestion) {
    const picked = msgs.flatMap((x) => x.content ?? []).filter((p) => p.type === "tool" && p.name === "question");
    verdict(picked.length === 0, "(5) the picker allowed, the question goes in words (#9311)", `question ${picked.length}`);
  }
  report.push(`--- last answer ---\n${lastAnswer(msgs)}`);
} catch (e) {
  errorVerdict(e.message, setup);
  // A turn that did not end: what the session and the bridge did up to now, for the verdict's reader.
  for (const id of runSessions)
    try { report.push(`\n===== session ${id} (interrupted) =====\n${journal(messages(id))}`); } catch (x) { problem(`journal ${id}: ${x.message}`); }
  report.push(`--- bridge tools/call ---\n${sceneTeeCalls(teeLog, live.mark).map((c) => `[${c.t}] ${c.name}${c.error ? " ERROR" : ""} ${JSON.stringify(c.args)}\n${c.text}`).join("\n")}`);
  if (scene.role) report.push(`role #${scene.role} bound to: ${(await bound(scene.role).catch(() => null)) ?? "—"}`);
} finally {
  let places = [];
  try { places = cleanup.places(); } catch (e) { problem(e.message); }
  delete env.OPENCODE_PASSWORD;
  if (serve && serve.exitCode === null) {
    const done = new Promise((r) => serve.once("exit", r));
    serve.kill("SIGTERM");
    await Promise.race([done, sleep(15_000)]);
    if (serve.exitCode === null && serve.signalCode === null) { serve.kill("SIGKILL"); problem("serve required SIGKILL"); }
  }
  try { places.push(...cleanup.places()); } catch (e) { problem(e.message); }
  await cleanup.revoke(places, P, person);
  for (const c of sceneTeeCalls(teeLog, 0)) if (!c.error && /^iskron_add_/.test(c.name)) {
    const id = idOf(c.text);
    if (id && !laid.includes(id)) laid.push(id);
  }
  for (const id of [...laid].reverse()) await take(id).catch((e) => problem(`cleanup #${id}: ${e.message}`));
  await P.close();
  await cleanup.stopDaemons();
}
writeFileSync(reportFile, scrub([...verdicts, ...report].join("\n")) + "\n", { mode: 0o600 });
process.stdout.write(scrub(verdicts.join("\n")) + `\n\nreport: ${reportFile}\n`);
process.exit(setup ? 2 : count() ? 1 : 0);
