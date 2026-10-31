#!/usr/bin/env node
// The pi layer of the live role probes (case №2428 under №2394): in pi there is no subagent
// tool and the supply projects no roles for it (vimarsha #9261) — the child is a separate
// `pi -p` process whose first prompt is the launch line «start <граф> <роль> <дело №N>
// от <место>», and the installed package's extension raises that child's bridge as a satellite
// (js/extension/tools.ts). The run measures the mechanics first — did the root raise the child
// process WITH the launch line, did the child stand as a satellite, did it enter the case — and
// then the scene signs as in OpenCode (h — the recaller scene of №2302 word for word, f — the
// multi-actor intake, --fixed-brief the same fixed brief for every model compared).
//
//   node scripts/stand-run-pi.mjs --token-file F --url U --api A --realm @owner/slug
//     [--pi /opt/homebrew/bin/pi] [--bridge dist/dev/skills/establish-mcp/scripts/iskron.mjs]
//     [--model openai-codex/gpt-5.6-sol] [--sub-model zai/glm-5.3] [--only h,f]
//     [--turn-minutes 15] [--require-empty] [--fixed-brief F] [--report F] [--raw-json F] [--keep]
//
// Isolation: the pi home, the graph, the identity. The run's own PI_CODING_AGENT_DIR names an
// agent dir built for the run: settings.json carries the package (the machine's installed
// git:github.com/iskron-ai/skills clone, by resolved absolute path — loaded, never modified) and
// the CHILD's default model (--sub-model as defaultProvider/defaultModel, so a bare `pi -p`
// spawned by the root runs it; the parent-injected PI_PROVIDER/PI_MODEL never override it),
// a fresh deviceId, and the machine's model catalogs; auth.json takes the machine's entries —
// api keys as they lie, an OAuth entry WITHOUT its refresh token, so the isolated home runs on
// the live access token alone and can never rotate the person's login (case №2394) — a run
// needing an expired access token fails fast, exit 2, telling to refresh the real login first.
// The bridge under probe (ISKRON_BRIDGE_PATH → evals/graph-probes/tee-bridge.mjs, every JSON-RPC
// line journaled; the tee raises --bridge) talks to the server of --url — the stand-mcp-ledger
// loopback URL for LAB runs. The carrier: the raw pi sessions of the root and every child
// (--session-dir), the tee journal, the standings/grant logs of the run's auth dirs, and the
// launch case's own journal (read back and copied into the report; the case stays on the server).
// Exit 0 — all passed, 1 — failed/blocked/provisional, 2 — setup failed. No haiku anywhere.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { personApi } from "./stand-person.mjs";
import { turnMinutes as parseMinutes, secretScrubber } from "./stand-recall-evidence.mjs";
import { runCleanup, removeRawLogs } from "./stand-recall-cleanup.mjs";
import {
  H_PROMPT,
  fPrompts,
  fixedBriefPrompt,
  idOf,
  layScene,
  makeReporters,
  sceneTaker,
  stdioBridge,
  teeBridges,
  teeCalls as sceneTeeCalls,
  teeLines as sceneTeeLines,
} from "./stand-recall-scene.mjs";
import { parseLaunchLine, readPiSession, firstUserText, isolatedPiAuth, piActualModels, piEvidence, piJournal, piLastAnswer, piToolCalls, isSearchCall, looksCall, toBrotherCall } from "./stand-pi-evidence.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  const head = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  process.stdout.write(head.slice(0, head.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n");
  process.exit(0);
}
const fail = (code, t) => (process.stderr.write(`stand-run-pi: ${t}\n`), process.exit(code));
const tokenFile = arg("--token-file");
const URL_ = arg("--url");
const apiArg = arg("--api");
const realm = arg("--realm");
const piArg = arg("--pi", "/opt/homebrew/bin/pi");
const bridgeArg = arg("--bridge", join(root, "dist/dev/skills/establish-mcp/scripts/iskron.mjs"));
const model = arg("--model", "openai-codex/gpt-5.6-sol");
const subModel = arg("--sub-model", "zai/glm-5.3");
const PROBES = ["h", "f"];
const only = arg("--only", PROBES.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const keep = process.argv.includes("--keep");
const requireEmpty = process.argv.includes("--require-empty");
const fixedBrief = arg("--fixed-brief", null) ? readFileSync(arg("--fixed-brief", null), "utf8").trim() : null;
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const reportFile = resolve(arg("--report", `stand-run-pi-${stamp}.txt`));
const rawFile = arg("--raw-json") ? resolve(arg("--raw-json")) : null;
let turnMinutes;
try { turnMinutes = parseMinutes(arg("--turn-minutes", "15")); } catch (e) { fail(2, e.message); }
if (!tokenFile || !URL_ || !apiArg || !realm) fail(2, "--token-file, --url, --api and --realm are required");
if (!/^[\w.-]+\/[\w.-]+$/.test(model) || /haiku/i.test(model)) fail(2, "--model: provider/id, never haiku");
if (!/^[\w.-]+\/[\w.-]+$/.test(subModel) || /haiku/i.test(subModel)) fail(2, "--sub-model: provider/id, never haiku");
if (!only.length || only.some((p) => !PROBES.includes(p))) fail(2, `--only takes a subset of ${PROBES.join(",")}`);
const pi = resolve(piArg);
const bridge = resolve(bridgeArg);
const tee = join(root, "evals/graph-probes/tee-bridge.mjs");
for (const [n, p] of [["--pi", pi], ["--bridge", bridge], ["--skills source", join(homedir(), ".pi/agent")], ["tee", tee], ["--token-file", tokenFile]])
  if (!existsSync(p)) fail(2, `${n}: ${p} does not exist`);
if ((statSync(tokenFile).mode & 0o077) !== 0) fail(2, `${tokenFile} is readable by others — chmod 600`);
const token = readFileSync(tokenFile, "utf8").trim();
if (!token) fail(2, "empty token file");
const { secrets, remember: rememberSecrets, scrub } = secretScrubber(token);
const [providerID, modelID] = model.split("/");
const [subProvider, subModelID] = subModel.split("/");
if (providerID === subProvider && modelID === subModelID) fail(2, "--sub-model must differ from --model: the child's model is told apart by it");
const person = personApi({ api: apiArg, token });

// The installed package of the machine's pi: settings names git:github.com/iskron-ai/skills, the
// clone lies under the agent dir's git/ tree. Connected by resolved absolute path — pi loads a
// local package from the path without copying or updating it (pi docs, packages.md).
const machineAgent = join(homedir(), ".pi/agent");
const machineSettings = JSON.parse(readFileSync(join(machineAgent, "settings.json"), "utf8"));
const pkgRef = (machineSettings.packages ?? []).find((p) => typeof p === "string" && p.replace(/@[^/]*$/, "") === "git:github.com/iskron-ai/skills");
const pkgDir = join(machineAgent, "git", pkgRef.slice("git:".length).replace(/@[^/]*$/, ""));
for (const f of [join(pkgDir, "extensions/iskron.js"), join(pkgDir, "skills/iskron/SKILL.md"), join(pkgDir, "skills/establish-mcp/scripts/iskron.mjs")])
  if (!existsSync(f)) fail(2, `the installed package looks incomplete: ${f}`);
const pkgVersion = (readFileSync(join(pkgDir, "extensions/iskron.js"), "utf8").match(/VERSION\s*=\s*"?(\d+\.\d+\.\d+)/) ?? [])[1] ?? "unknown";

const run = mkdtempSync(join(join(tmpdir(), "opencode"), "stand-run-pi-"));
// Evidence is in scrubbed reports; --keep never retains raw transport logs or credentials.
// The exit handler is registered BEFORE the first credential touches the disk — a refusal at any
// later setup gate still leaves nothing secret behind (observed the hard way: a token file that
// outlived its own fail(2)).
const home = join(run, "home");
const cwd = join(run, "project");
const auth = join(run, "auth");
const agent = join(run, "pi-agent");
const sessions = join(run, "sessions");
const teeLog = join(run, "bridge.jsonl");
for (const d of [cwd, join(home, "tmp"), join(home, ".local/share"), join(home, ".local/state"), join(home, ".cache"), auth, agent, sessions])
  mkdirSync(d, { recursive: true, mode: d === auth || d === agent ? 0o700 : 0o755 });
process.on("exit", () => {
  for (const p of [home, auth, join(run, "auth-person")]) rmSync(p, { recursive: true, force: true });
  rmSync(join(agent, "auth.json"), { force: true }); // the isolated home's copy of the machine's keys
  removeRawLogs(run);
  if (keep) process.stderr.write(`run dir kept (credentials removed): ${run}\n`);
  else rmSync(run, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
});
writeFileSync(join(auth, "token"), token + "\n", { mode: 0o600 });

// The isolated agent dir: the child's default model, the installed package, its own identity.
writeFileSync(
  join(agent, "settings.json"),
  JSON.stringify(
    {
      defaultProvider: subProvider,
      defaultModel: subModelID,
      defaultThinkingLevel: machineSettings.defaultThinkingLevel ?? "high",
      packages: [pkgDir],
      deviceId: randomUUID(),
    },
    null,
    2,
  ),
);
writeFileSync(join(agent, "trust.json"), JSON.stringify({ [cwd]: true }, null, 2));
for (const f of ["models.json", "models-store.json"]) cpSync(join(machineAgent, f), join(agent, f));
// Model keys: the machine's entries as they lie; an OAuth entry without its refresh token.
{
  const machineAuth = JSON.parse(readFileSync(join(machineAgent, "auth.json"), "utf8"));
  rememberSecrets(machineAuth);
  let isolated;
  try {
    isolated = isolatedPiAuth({ machineAuth, needed: [providerID, subProvider] });
  } catch (e) {
    fail(2, e.message);
  }
  writeFileSync(join(agent, "auth.json"), JSON.stringify(isolated, null, 2), { mode: 0o600 });
}

const env = {
  PATH: `${dirname(pi)}:${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
  HOME: home,
  TMPDIR: join(home, "tmp"),
  LANG: "en_US.UTF-8",
  PI_CODING_AGENT_DIR: agent,
  PI_CODING_AGENT_SESSION_DIR: sessions,
  PI_OFFLINE: "1",
  PI_SKIP_VERSION_CHECK: "1",
  PI_TELEMETRY: "0",
  // The extension starts the tee, the tee the bridge under probe, every JSON-RPC line journaled.
  ISKRON_BRIDGE_PATH: tee,
  ISKRON_PROBE_BRIDGE: bridge,
  ISKRON_PROBE_LOG: teeLog,
  ISKRON_BRIDGE_AUTH_DIR: auth,
  ISKRON_BRIDGE_URL: URL_,
  ISKRON_BRIDGE_NO_UPDATE: "1",
  ISKRON_BRIDGE_NO_BROWSER: "1",
};
// The delivery's own resolution confirms the connection: pi list names the package and its path.
{
  const list = spawnSync(pi, ["list"], { env, cwd, encoding: "utf8", timeout: 60_000 });
  if (list.status !== 0 || !String(list.stdout).includes(pkgDir)) fail(2, `pi list in the isolated home does not resolve the package: ${String(list.stdout).slice(0, 200)} ${String(list.stderr).slice(0, 200)}`);
  process.stderr.write(`stand-run-pi: isolated home ${agent} · package ${pkgRef} → ${pkgDir} (extension ${pkgVersion}) · child default ${subModel}\n`);
}
// The carrier answers at all before anything is laid: the run's credential reads its channels.
// Local setup is done by here — an offline run reaches this line with the home built and --keep keeps it.
{
  let st = 0;
  try {
    st = (await fetch(apiArg.replace(/\/$/, "") + "/me/channels", { headers: { Authorization: `Bearer ${token}`, "X-NKS-Realm": realm } })).status;
  } catch (e) {
    fail(2, `--api ${apiArg}: ${e.message}`);
  }
  if (st !== 200) fail(2, `--api ${apiArg}: GET /me/channels → ${st}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let interrupted;
const checkInterrupted = () => { if (interrupted) throw interrupted; };
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  interrupted = new Error(`${signal}: run interrupted; cleanup requested`);
  process.stderr.write(`stand-run-pi: ${interrupted.message}\n`);
});

const rawJournals = [];
const { verdicts, report, problem, verdict, provisional, error: errorVerdict, count } = makeReporters();
const cleanup = runCleanup({ run, auth, bridge, env, cwd, report, scrub, problem });
const P = stdioBridge({ run, bridge, env, token, name: "stand-run-pi", problem });
const laid = []; // node ids in the order laid, taken off in reverse
const scene = {};
let setupPhase = true; // until the first probe: a refusal here is the run's, exit 2
let take = sceneTaker(P, { realm, problem, laid }); // a half-laid scene is taken off too
let factOn = async () => {
  throw new Error("the scene was never laid");
};

/** The sessions that appeared under the dir since `before` (files pi wrote — root and children). */
const newSessions = (before) =>
  readdirSync(sessions)
    .filter((f) => f.endsWith(".jsonl") && !before.has(f))
    .map((f) => readPiSession(join(sessions, f)))
    .filter(Boolean)
    .sort((x, y) => String(x.header?.timestamp ?? x.file).localeCompare(String(y.header?.timestamp ?? y.file)));

// One probe: the root pi process running the prompt to its end within the declared bound. The
// children it spawns live inside the root's bash tool windows — their processes die with the run.
async function runRoot(key, prompt) {
  checkInterrupted();
  const out = join(run, `pi-${key}.out`);
  const err = join(run, `pi-${key}.err`);
  const before = new Set(readdirSync(sessions));
  const child = spawn(pi, ["-p", "--model", model, "--name", `stand-run-pi-${key}`, prompt], {
    env,
    cwd,
    detached: true, // a process group of its own: a timeout kill takes the children with the root
    stdio: ["ignore", "pipe", "pipe"],
  });
  let outBuf = "";
  let errBuf = "";
  child.stdout.setEncoding("utf8").on("data", (d) => (outBuf += d));
  child.stderr.setEncoding("utf8").on("data", (d) => (errBuf += d));
  let ended = false;
  const done = new Promise((r) => child.once("exit", () => { ended = true; r(); }));
  let timedOut = false;
  const timer = sleep((turnMinutes * 60 + 120) * 1000).then(() => { timedOut = !ended; });
  await Promise.race([done, timer]);
  if (timedOut) {
    process.stderr.write(`stand-run-pi: (${key}) the root pi did not end in ${turnMinutes} min — killing the process group\n`);
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
    await Promise.race([done, sleep(10_000)]);
    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
      await Promise.race([done, sleep(5000)]);
    }
    problem(`(${key}) the root pi did not end in ${turnMinutes} min — killed`);
    writeFileSync(out, outBuf, { mode: 0o600 });
    writeFileSync(err, errBuf, { mode: 0o600 });
    return { killed: true, stdout: outBuf, stderr: errBuf, before };
  }
  await done;
  writeFileSync(out, outBuf, { mode: 0o600 });
  writeFileSync(err, errBuf, { mode: 0o600 });
  if (child.exitCode !== 0) problem(`(${key}) root pi exited ${child.exitCode}${child.signalCode ? ` by ${child.signalCode}` : ""}: ${errBuf.slice(0, 300)}`);
  return { killed: false, stdout: outBuf, stderr: errBuf, before };
}

/** The launch cases the root named, read back through the scene bridge for the report. */
async function caseLines(numbers) {
  const lines = [];
  for (const no of [...new Set(numbers)].slice(0, 3)) {
    const h = await P.call("iskron_case", { realm, action: "history", room: `#${no}`, from_start: true, keep_cursor: true }).catch(() => null);
    lines.push(`--- launch case #${no} (read back; the case itself stays on the server) ---\n${h ? h.text.slice(0, 4000) : "unreadable"}`);
  }
  return lines;
}

try {
  await P.init();
  checkInterrupted();
  ({ factOn, take } = await layScene(P, { realm, stamp, cwd, report, problem, requireEmpty, sleep, scene, laid }));
  report.push(`realm ${realm} · pi ${piArg} (${(spawnSync(pi, ["--version"], { env, cwd, encoding: "utf8", timeout: 30_000 }).stdout ?? "").trim()}) · root ${model} · sub ${subModel} (defaultModel of the isolated home) · bridge ${bridge} · package ${pkgRef} → ${pkgDir} (extension ${pkgVersion})`);
  const intake = fPrompts(scene);
  if (fixedBrief) intake.f = [fixedBriefPrompt(intake.f[0], scene, fixedBrief)];
  const PROMPTS = { h: [H_PROMPT], f: intake.f };

  for (const key of only) {
    setupPhase = false;
    const fact = await factOn("word");
    const mark = sceneTeeLines(teeLog).length;
    const { stdout, stderr, before } = await runRoot(key, PROMPTS[key][0]);
    report.push(`\n===== (${key}) root ${model} → fact #${fact} =====`);
    report.push(`--- root stdout ---\n${stdout.slice(0, 4000)}\n--- root stderr ---\n${stderr.slice(0, 4000)}`);
    // The sessions this probe wrote: the root's (its first user text is the prompt) and the
    // children's (their first user text starts with the launch line — the child IS a session).
    const all = newSessions(before);
    const rootSession = all.find((s) => firstUserText(s).startsWith(PROMPTS[key][0].slice(0, 40)) && !parseLaunchLine(firstUserText(s)));
    const children = all.filter((s) => parseLaunchLine(firstUserText(s))).map((s) => ({ session: s, launch: parseLaunchLine(firstUserText(s)) }));
    if (!rootSession) throw new Error(`(${key}) the root's session file was not found among ${all.length} new session files`);
    for (const s of all) {
      const label = s === rootSession ? "root" : children.some((c) => c.session === s) ? "child" : "other";
      // The raw carrier: the whole parsed session file — the messages, the tool calls, the
      // model/usage evidence — into --raw-json; the readable journal into the report.
      rawJournals.push({ key, label, file: s.file, header: s.header, entries: s.entries });
      report.push(`--- raw session ${s.file} (${label}) · models: ${piActualModels(s).map((m) => `${m.model}×${m.messages}`).join(", ") || "UNKNOWN"} ---\n${piJournal(s)}`);
    }
    // The bridges this probe raised: the first is the root process's; the rest are children's
    // (a child's bridges are born inside the root's bash window — the child's whole lifetime is).
    const bridges = teeBridges(teeLog, mark);
    const rootPid = bridges[0]?.pid ?? null;
    const calls = sceneTeeCalls(teeLog, mark);
    const rootCallsTee = calls.filter((c) => c.pid === rootPid);
    const childCallsTee = calls.filter((c) => c.pid !== rootPid);
    report.push(`--- bridges this probe (${bridges.length}) ---\n${bridges.map((b) => `pid${b.pid} born ${b.firstAt} initialize ${b.initializeAt} lines ${b.lines}`).join("\n")}`);
    report.push(`--- bridge tools/call · root process ---\n${rootCallsTee.map((c) => `[${c.t}] pid${c.pid} ${c.name}${c.error ? " ERROR" : ""} ${JSON.stringify(c.args)}\n${c.text}`).join("\n")}`);
    report.push(`--- bridge tools/call · child processes (extension service moves included) ---\n${childCallsTee.map((c) => `[${c.t}] pid${c.pid} ${c.name}${c.error ? " ERROR" : ""} ${JSON.stringify(c.args)}\n${c.text}`).join("\n")}`);
    // The child's first prompt — the brief as it actually arrived (the extension's word included).
    for (const c of children) report.push(`--- child ${c.session.file} first prompt ---\n${firstUserText(c.session).slice(0, 6000)}`);
    report.push(...await caseLines(children.map((c) => c.launch.no)));
    const rootCalls = piToolCalls(rootSession);
    const childSessions = children.map((c) => ({ session: c.session, launch: c.launch }));
    const evidence = piEvidence({ key, root: { session: rootSession }, children: childSessions, calls, scene, fact, fixedBrief, briefText: intake.f[0] });
    report.push(`OBSERVATIONS (${key})\n${JSON.stringify({ ...evidence, received: evidence.received.map((r) => ({ ...r, firstPrompt: r.firstPrompt.slice(0, 200) })) }, null, 2)}`);
    const answer = piLastAnswer(rootSession);
    const seq = [...rootCalls, ...children.flatMap(({ session }) => piToolCalls(session))]
      .map((c) => `${c.name.replace(/^iskron_/, "")}${c.args?.action ? `:${c.args.action}` : ""}`)
      .join(" → ") || "no calls";

    // (h) — the mechanics first, then the scene signs of №2302 [20] as in OpenCode.
    if (key === "h") {
      const launchCmd = evidence.launches[0] ?? null;
      verdict(
        Boolean(launchCmd && (launchCmd.launch || launchCmd.inline)),
        "(h) launched: the root raised the child process with the launch line",
        launchCmd ? `command ${launchCmd.command.slice(0, 300)} · launch ${launchCmd.launch ? `case №${launchCmd.launch.no} от ${launchCmd.launch.of}` : "inline shape only"}` : `no bash pi -p call in the root session (${seq})`,
      );
      // The root's own seat — from its own stand answer through the tee.
      const rootStand = rootCallsTee.find((c) => c.name === "iskron_stand" && !c.error);
      const rootSeat = rootStand ? (rootStand.text.match(/@[\w.-]+:\S+/)?.[0] ?? null) : null;
      const stand = childCallsTee.find((c) => c.name === "iskron_stand" && c.args.satellite_of);
      verdict(
        Boolean(stand && !stand.error && rootSeat && String(stand.args.satellite_of) === rootSeat),
        "(h) satellite: the child's bridge stood a satellite of the root's own seat",
        stand ? `satellite_of ${stand.args.satellite_of} → ${stand.text.slice(0, 160)} · root seat ${rootSeat}` : `no iskron_stand with satellite_of on a child bridge (root seat ${rootSeat ?? "none — the root itself never stood"})`,
      );
      const join = childCallsTee.find((c) => c.name === "iskron_case" && c.args?.action === "join" && children.some((ch) => `#${ch.launch.no}` === String(c.args.room)));
      verdict(
        Boolean(join && !join.error),
        "(h) joined: the child entered the case its launch line named",
        join ? `room ${JSON.stringify(join.args.room)} → ${join.text.slice(0, 160)}` : `no iskron_case join of ${children.map((ch) => `#${ch.launch.no}`).join(", ") || "any case"} on a child bridge`,
      );
      // The scene signs — the same as the OpenCode (h): the child searched on its own, the
      // caller's own look, no word to a brother or the person by either, answer with #факт and 45.
      const childSearched = children.some(({ session }) => piToolCalls(session).some((c) => isSearchCall(c) || looksCall(c, fact)));
      const iLook = rootCalls.findIndex((c) => looksCall(c, fact));
      const rootBro = rootCalls.findIndex((c) => toBrotherCall(c, scene.human));
      const childBro = children.some(({ session }) => piToolCalls(session).some((c) => toBrotherCall(c, scene.human)));
      const has45 = /(?<![\d#])45(?!\d)/.test(answer);
      verdict(
        childSearched && iLook !== -1 && rootBro === -1 && !childBro && answer.includes(`#${fact}`) && has45,
        `(h) the recaller searched, the caller's own look #${fact}, no word to a brother or the person, answer with #${fact} and 45`,
        `child searched ${childSearched} · look ${iLook} · brother ${rootBro}${childBro ? " (child)" : ""} · ${seq}`,
      );
      continue;
    }
    // (f) — the intake scene: the same mechanics chain first, then PROVISIONAL — mechanical
    // rejection only, semantic acceptance stays with the human.
    const launchCmd = evidence.launches[0] ?? null;
    const stand = childCallsTee.find((c) => c.name === "iskron_stand" && c.args.satellite_of && !c.error);
    const join = childCallsTee.find((c) => c.name === "iskron_case" && c.args?.action === "join" && !c.error);
    verdict(Boolean(launchCmd && stand && join), "(f) launched+satellite+joined (the same mechanics as (h))", `launch ${Boolean(launchCmd)} · satellite ${Boolean(stand)} · join ${Boolean(join)}`);
    if (evidence.errors.length) verdict(false, `(f) intake evidence`, evidence.errors.join("; "));
    else provisional("PROVISIONAL (f) intake in pi: human semantic acceptance required");
  }
} catch (e) {
  errorVerdict(e.message, setupPhase);
} finally {
  cleanup.capture("before session shutdown");
  let places = [];
  try { places = cleanup.places(); } catch (e) { problem(e.message); }
  try {
    const carried = new Set(rawJournals.filter((j) => j.file).map((j) => j.file));
    for (const name of readdirSync(sessions)) {
      if (carried.has(name)) continue;
      const s = readPiSession(join(sessions, name));
      if (s) { rawJournals.push({ recovery: true, file: s.file, header: s.header, entries: s.entries }); report.push(`--- recovery raw session ${s.file} ---\n${piJournal(s)}`); }
    }
  } catch (e) { problem(`session recovery: ${e.message}`); }
  if (scene.brother) places.push({ realm, karta: scene.agent, name: scene.brother });
  await cleanup.revoke(places, P, person);
  if (!keep) {
    for (const c of sceneTeeCalls(teeLog, 0)) if (!c.error && /^iskron_add_/.test(c.name)) {
      const id = idOf(c.text);
      if (id && !laid.includes(id)) laid.push(id);
    }
    if (sceneTeeCalls(teeLog, 0).some((c) => c.name === "iskron_batch" && !c.error)) problem("cleanup: successful batch requires inspection of created nodes; raw calls retained");
    for (const id of [...laid].reverse()) await take(id).catch((e) => problem(`cleanup node #${id}: ${e.message}`));
  } else report.push(`scene kept: ${laid.map((n) => `#${n}`).join(" ")}`);
  await P.close();
  await cleanup.stopDaemons();
  cleanup.capture("after bridge/daemon shutdown");
}
const text = scrub([...verdicts, ...report].join("\n")) + "\n";
writeFileSync(reportFile, text, { mode: 0o600 });
if (rawFile) writeFileSync(rawFile, scrub(JSON.stringify({ journals: rawJournals, lifecycleSnapshots: cleanup.snapshots }, null, 2)) + "\n", { mode: 0o600 });
process.stdout.write(scrub(verdicts.join("\n")) + `\n\nreport: ${reportFile}\nrun dir: ${run}${keep ? "" : " (removed)"}\n`);
process.exit(setupPhase ? 2 : count() ? 1 : 0);
