// Подкоманда stop (граф nks-dev: #7518, #5085; контракт приказа — дело №669): человек снимает
// место агента машины по имени места или id сессии — приказом останова api 0.122, а на api без
// ручки приказа (404) — снятием места. Демон машины с местом против фейка NKS и его приказов.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию: у моста без подкоманды stop нет —
// аргумент уходит мосту, и снимка места он не печатает.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { connectSeam, helloFrame, patShaOf } from "../shared/seam.ts";
import { seamSocketPath } from "../shared/seam-entrance.ts";
import { startFakeNks } from "./fake-nks.mjs";
import { BRIDGE, entrance, env, NODE, rpc } from "./status-kit.mjs";

// Asynchronously: the fake api answers from this same process.
const stop = (dir, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(NODE, [BRIDGE, "stop", ...args, "--auth-dir", dir], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`stop timed out:\n${stdout}\n${stderr}`));
    }, 15000);
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("exit", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });

/** A daemon with one session standing on `name`; the seat's id is on the fake. */
async function seated(t, name) {
  const dir = mkdtempSync(join(tmpdir(), "stop-cli-"));
  const fake = await startFakeNks({ pat: "status-pat" });
  const d = spawn(NODE, [BRIDGE, "daemon", "--auth-dir", dir], { env, stdio: "ignore" });
  let link;
  t.after(async () => {
    link?.close();
    const exited = new Promise((r) => d.once("exit", r));
    d.kill("SIGKILL");
    await exited;
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  (await entrance(dir)).close();
  link = await connectSeam(
    seamSocketPath(dir),
    helloFrame({
      build: "v7.9.0+test",
      path: BRIDGE,
      argv: [fake.mcpUrl, "--auth-dir", dir],
      patSha: patShaOf("status-pat"),
    }),
    3000,
  );
  const init = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "pi" } };
  await rpc(link, "initialize", init, 1);
  const stood = await rpc(
    link,
    "tools/call",
    { name: "iskron_stand", arguments: { realm: "nks-dev", karta: 931, name } },
    2,
  );
  assert.ok(!stood.result?.isError, JSON.stringify(stood));
  const id = [...fake.state.channels.values()]
    .flatMap((c) => [...c.places.values()])
    .find((p) => p.name === name)?.standing_id;
  assert.ok(id, "the seat id on the fake");
  // The bridge learns the id from hello or register: wait until the snapshot carries it.
  for (let i = 0; i < 100; i++) {
    const s = spawnSync(NODE, [BRIDGE, "status", "--json", "--auth-dir", dir], {
      env,
      encoding: "utf8",
    });
    if (JSON.parse(s.stdout).sessions?.[0]?.places?.[0]?.standing_id === id) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { dir, fake, id, session: link.welcome.session };
}

test("stop <seat> issues a stop order to the seat by its id, under the bridge's key", async (t) => {
  const { dir, fake, id } = await seated(t, "stop-me");
  const r = await stop(dir, ["stop-me"]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /приказ останова выдан месту stop-me/, r.stdout);
  const asked = fake.state.orders.human;
  assert.equal(asked.length, 1, JSON.stringify(asked));
  assert.equal(asked[0].method, "POST");
  assert.equal(asked[0].id, id);
  assert.equal(asked[0].body.reason_code, "person_request");
  assert.ok(asked[0].body.client_id, "the order carries a client_id");
  assert.equal([...fake.state.orders.list.values()][0]?.standing_id, id, "the order is put");
});

test("stop <session id> on an api without the stop route revokes the seat instead", async (t) => {
  const { dir, fake, id, session } = await seated(t, "old-api");
  await fake.control({ orders_route_missing: true });
  const r = await stop(dir, [session]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /404 ручки\) — место old-api \(nks-dev\) снято \(revoke\)/, r.stdout);
  assert.deepEqual(
    fake.state.orders.human.map((h) => [h.method, h.id]),
    [
      ["POST", id],
      ["DELETE", id],
    ],
  );
});

test("stop names no seat it does not see, and fails loudly", async (t) => {
  const { dir, fake } = await seated(t, "here");
  const r = await stop(dir, ["nobody"]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /ни сессии, ни места «nobody»/, r.stderr);
  assert.equal(fake.state.orders.human.length, 0, "nothing is sent");
});
