// Конец отдельного прогона (граф @nks/nks-dev, #6593, #11359): остановка экземпляра
// `opencode run --standalone` — ещё не конец прогона: перезагрузка плагина посреди живого
// прогона останавливает его так же, и сессия места не теряет. Любая остановка — отлучка (`away`,
// маркер возврата пишется), а мосту называется pid прогона: место кончает демон, только если
// прогон ушёл за окно (lifeend-run.test.mjs). Прогон, продолживший сессию (--session), и общий
// сервис — отлучка без прогона, как прежде.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { BUILT_PLUGIN } from "./built.mjs";
import { bridgeEnv, callsIn, event, pidOf } from "./lead-kit.mjs";
import { lostMarkers, plugin, SANDBOX, until } from "./opencode-kit.mjs";

// The bundle's own judgement of a run's argv, exported from a copy (ISKRON_OPENCODE_PLUGIN aims it).
const copy = join(SANDBOX, "runshape-built.mjs");
writeFileSync(
  copy,
  readFileSync(process.env.ISKRON_OPENCODE_PLUGIN || BUILT_PLUGIN, "utf8") +
    "\nexport { continuesSession };\n",
);
const { continuesSession } = await import(pathToFileURL(copy).href);

const names = (rec) => [...rec.tools().keys()];

/** Подставной прогон: процесс с командной строкой `opencode run …`; null — прогона нет (общий сервис). */
function run(t, args) {
  if (!args) return null;
  const p = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)", "--", ...args], {
    stdio: "ignore",
  });
  t.after(() => p.kill("SIGKILL"));
  return p;
}

/** Корень держит место через мост; остановка плагина посреди хода — что услышал мост и что лежит на диске. */
async function reloadMidTurn(t, name, args) {
  const calls = join(SANDBOX, `${name}.calls`);
  writeFileSync(calls, "");
  const client = run(t, args);
  const b = bridgeEnv(name, {
    FB_CALLS: calls,
    ...(client ? { ISKRON_OPENCODE_CLIENT_PID: String(client.pid) } : {}),
  });
  const session = `s-${name}`;
  const rec = await plugin(b.env, {
    sessions: [{ id: session, time: {}, location: { directory: `/work/${name}` } }],
  });
  await until(() => names(rec).length === 3, "the server's tools", 8000);
  await rec.call("iskron_channel", { action: "connect" }, session);
  const pid = pidOf(b.log);
  appendFileSync(`${b.events}.${pid}`, event("held", { key: `${name}--931--nks-dev` }));
  await until(() => rec.said().includes(`мост держит место ${name}--931--nks-dev`), "held");
  rec.emit({ type: "session.execution.started", data: { sessionID: session } }); // mid-turn
  await rec.stop();
  const said = () =>
    callsIn(calls).filter((c) => c.pid === pid && /^iskron\/(end|away)$/.test(c.name));
  await until(() => said().length, "the bridge's last word");
  return { said: said(), client, markers: lostMarkers() };
}

test("a reload inside a live standalone run of a new session: away with the run's pid, the return marker kept — no end", async (t) => {
  const { said, client, markers } = await reloadMidTurn(t, "run-new", [
    "opencode",
    "run",
    "--standalone",
    "do it",
  ]);
  assert.deepEqual(
    said.map((c) => [c.name, c.arguments]),
    [["iskron/away", { run_pid: client.pid }]],
    "an absence naming the run — the daemon ends the seat only once the run is gone",
  );
  assert.ok(markers.length >= 1, "the return marker is written");
});

test("a standalone run resuming a session (--session): a plain absence, no run named", async (t) => {
  const args = ["opencode", "run", "--standalone", "--session", "ses_x", "go on"];
  const { said, markers } = await reloadMidTurn(t, "run-resumed", args);
  assert.deepEqual(
    said.map((c) => [c.name, c.arguments]),
    [["iskron/away", {}]],
  );
  assert.ok(markers.length >= 1);
});

// The run's options are any argv elements after `run` up to `--` — OpenCode reads flags after
// the message too (v2.2.7: `opencode run 'x' --session` — «Missing value for flag --session»):
// a prompt that mentions a continuation flag is no continuation, it is an element of its own; a
// known option taking a value swallows the element after it; an unknown one is skipped alone.
for (const [what, args, continues] of [
  ["a prompt naming --session", ["--standalone", "Explain the --session flag"], false],
  ["--session abc and a message", ["--standalone", "--session", "abc", "x"], true],
  ["-c", ["--standalone", "-c"], true],
  ["--session=abc", ["--standalone", "--session=abc", "x"], true],
  ["a value that looks like a flag", ["--standalone", "--title", "-c", "x"], false],
  // The reviewer's argv (№5817 [579]): the flag after the message.
  [
    "--session after the message",
    ["--standalone", "continue the task", "--session", "ses_x"],
    true,
  ],
  ["an unknown option with a value first", ["--worktree", "example", "--session", "x"], true],
  ["-c after --", ["--standalone", "--", "-c"], false],
]) {
  // The judgement itself, on exact argv elements (the built bundle's own function).
  test(`the run's argv with ${what}: ${continues ? "a continuation" : "a new run"}`, () => {
    assert.equal(continuesSession(["/usr/bin/opencode", "run", ...args]), continues);
  });
  // Through a live process: outside Linux `ps` joins the elements with spaces (a stated limit,
  // runshape.ts argvOf) — a prompt with a flag's word inside is judged only where argv is exact.
  const joined = args.some((x) => /\s/.test(x) && x.split(/\s+/).some((w) => w.startsWith("-")));
  test(
    `a standalone run with ${what}: ${continues ? "a continuation, no run named" : "a new run, its pid named"}`,
    {
      skip: joined && process.platform !== "linux" ? "ps joins argv outside Linux" : false,
    },
    async (t) => {
      const name = `run-argv-${what.replace(/\W+/g, "-")}`;
      const { said, client } = await reloadMidTurn(t, name, ["opencode", "run", ...args]);
      assert.deepEqual(
        said.map((c) => [c.name, c.arguments]),
        [["iskron/away", continues ? {} : { run_pid: client.pid }]],
      );
    },
  );
}

test("a stop of the shared service (a default-shape run, a reload): a plain absence", async (t) => {
  const { said } = await reloadMidTurn(t, "run-shared", null);
  assert.deepEqual(
    said.map((c) => [c.name, c.arguments]),
    [["iskron/away", {}]],
  );
});
