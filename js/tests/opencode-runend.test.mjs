// Конец отдельного прогона (граф @nks/nks-dev, #6593, #11359): `opencode run --standalone` новой
// сессии обслуживается своим «serve --stdio» — его остановка и есть конец прогона, конец агента:
// мосту — `end`, место снимает свой мост сразу, не окно слуха. Прогон, продолживший сессию
// (--session), кончается, а сессия живёт — `away`, как перезагрузка; общий сервис конца прогона
// не узнаёт — у прогона по умолчанию его нет, как и прежде.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { bridgeEnv, callsIn, event, pidOf } from "./lead-kit.mjs";
import { plugin, SANDBOX, until } from "./opencode-kit.mjs";

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

/** Корень держит место через мост; остановка плагина — что услышал мост. */
async function stopHeard(t, name, args) {
  const calls = join(SANDBOX, `${name}.calls`);
  writeFileSync(calls, "");
  const client = run(t, args);
  const b = bridgeEnv(name, {
    FB_CALLS: calls,
    ...(client ? { ISKRON_OPENCODE_CLIENT_PID: String(client.pid) } : {}),
  });
  const rec = await plugin(b.env, { sessions: [{ id: `s-${name}`, time: {} }] });
  await until(() => names(rec).length === 3, "the server's tools", 8000);
  await rec.call("iskron_channel", { action: "connect" }, `s-${name}`);
  const pid = pidOf(b.log);
  appendFileSync(`${b.events}.${pid}`, event("held", { key: `${name}--931--nks-dev` }));
  await until(() => rec.said().includes(`мост держит место ${name}--931--nks-dev`), "held");
  await rec.stop();
  await until(
    () => callsIn(calls).some((c) => c.pid === pid && /^iskron\/(end|away)$/.test(c.name)),
    "the bridge's last word",
  );
  return callsIn(calls)
    .filter((c) => c.pid === pid && /^iskron\/(end|away)$/.test(c.name))
    .map((c) => c.name);
}

test("the end of a standalone run of a new session is its agent's end: the bridge is told end, not away", async (t) => {
  const heard = await stopHeard(t, "run-new", ["opencode", "run", "--standalone", "do it"]);
  assert.deepEqual(heard, ["iskron/end"], "the seat ends with the run");
});

test("a standalone run resuming a session (--session) ends, the session lives on: away, not end", async (t) => {
  const args = ["opencode", "run", "--standalone", "--session", "ses_x", "go on"];
  assert.deepEqual(await stopHeard(t, "run-resumed", args), ["iskron/away"]);
});

test("a stop of the shared service (a default-shape run, a reload) stays an absence: away", async (t) => {
  assert.deepEqual(await stopHeard(t, "run-shared", null), ["iskron/away"]);
});
