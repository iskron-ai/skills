// Подкоманда stop (граф nks-dev: #7518, #5085; контракт приказа — дело №669): человек снимает
// место агента машины по имени места или id сессии — приказом останова api 0.122, а на api без
// ручки приказа (404) — снятием места. Демон машины с местом против фейка NKS и его приказов.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию: у моста без подкоманды stop нет —
// аргумент уходит мосту, и снимка места он не печатает.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { connectSeam, helloFrame, patShaOf } from "../shared/seam.ts";
import { seamSocketPath } from "../shared/seam-entrance.ts";
import { startFakeNks } from "./fake-nks.mjs";
import { BRIDGE, entrance, env, NODE, rpc } from "./status-kit.mjs";

// Asynchronously: the fake api answers from this same process.
const stop = (dir, args, childEnv = env) =>
  new Promise((resolve, reject) => {
    const child = spawn(NODE, [BRIDGE, "stop", ...args, "--auth-dir", dir], {
      env: childEnv,
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

/** The personal token's home names the seat's server: the token is that server's key. */
const patOf = (fake) => ({ ...env, ISKRON_BRIDGE_URL: fake.mcpUrl });

test("stop <seat> issues a stop order to the seat by its id, under the bridge's key", async (t) => {
  const { dir, fake, id } = await seated(t, "stop-me");
  const r = await stop(dir, ["stop-me"], patOf(fake));
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
  const r = await stop(dir, [session], patOf(fake));
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

/** The snapshot's session whose seat carries a standing id, once the bridge learnt it. */
async function snapshotId(dir, session) {
  for (let i = 0; i < 100; i++) {
    const s = spawnSync(NODE, [BRIDGE, "status", "--json", "--auth-dir", dir], {
      env,
      encoding: "utf8",
    });
    const id = JSON.parse(s.stdout).sessions?.find((x) => x.local_id === session)?.places?.[0]
      ?.standing_id;
    if (id) return id;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

// No personal token: the key is the OAuth grant of the seat's server, not of the machine's choice.
const noPat = { ...env };
delete noPat.ISKRON_BRIDGE_TOKEN;

/** The grant store of a server in the grant directory, as the bridge keys it. */
function grant(dir, serverUrl, store) {
  const u = new URL(serverUrl);
  const h = createHash("sha256")
    .update(u.origin + u.pathname)
    .digest("base64url")
    .slice(0, 10);
  writeFileSync(join(dir, `${u.hostname}_${h}.json`), JSON.stringify(store), { mode: 0o600 });
}

test("stop keys the order with the grant of the seat's own server, not the machine's", async (t) => {
  const { dir, fake, id } = await seated(t, "own-server");
  fake.state.access = "grant-of-the-seat-server";
  grant(dir, fake.mcpUrl, { tokens: { access_token: "grant-of-the-seat-server" } });
  const r = await stop(dir, ["own-server"], noPat);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.deepEqual(
    fake.state.orders.human.map((h) => [h.method, h.id]),
    [["POST", id]],
  );
});

// Несколько серверов: личный токен другого сервера не уходит api места — ключ места — грант его сервера.
test("stop sends no personal token of another server to the seat's api: the seat's server grant goes", async (t) => {
  const { dir, fake, id } = await seated(t, "two-servers");
  fake.state.access = "grant-of-the-seat-server";
  grant(dir, fake.mcpUrl, { tokens: { access_token: "grant-of-the-seat-server" } });
  const r = await stop(dir, ["two-servers"], {
    ...env,
    ISKRON_BRIDGE_URL: "https://another-server.example/",
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.deepEqual(
    fake.state.orders.human.map((h) => [h.method, h.id, h.bearer]),
    [["POST", id, "grant-of-the-seat-server"]],
  );
});

test("stop refreshes an expired grant of the seat's server the bridge's way, then orders", async (t) => {
  const { dir, fake, id } = await seated(t, "expired");
  fake.state.access = "not-this";
  fake.state.refresh = "refresh-1";
  grant(dir, fake.mcpUrl, {
    client: { client_id: "c1" },
    tokens: { access_token: "stale", refresh_token: "refresh-1", expires_at: Date.now() - 1000 },
  });
  const refreshes = fake.state.counts.refresh;
  const r = await stop(dir, ["expired"], noPat);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.equal(fake.state.counts.refresh, refreshes + 1, "the grant was refreshed");
  assert.deepEqual(
    fake.state.orders.human.map((h) => [h.method, h.id]),
    [["POST", id]],
  );
});

test("stop with a grant that will not refresh says sign in again aloud and sends nothing", async (t) => {
  const { dir, fake } = await seated(t, "dead-grant");
  fake.state.refresh = "the-live-one";
  grant(dir, fake.mcpUrl, {
    client: { client_id: "c1" },
    tokens: { access_token: "stale", refresh_token: "dead", expires_at: Date.now() - 1000 },
  });
  const r = await stop(dir, ["dead-grant"], noPat);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /ВОЙДИ ЗАНОВО/, r.stderr);
  assert.equal(fake.state.orders.human.length, 0, "no foreign or stale key is sent");
});

test("stop <satellite session> orders the subagent's seat: no hold record needed", async (t) => {
  const { dir, fake } = await seated(t, "lead");
  const sat = await connectSeam(
    seamSocketPath(dir),
    helloFrame({
      build: "v7.9.0+sat",
      path: BRIDGE,
      argv: [fake.mcpUrl, "--auth-dir", dir, "--satellite"],
      patSha: patShaOf("status-pat"),
    }),
    3000,
  );
  t.after(() => sat.close());
  const init = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "cc" } };
  await rpc(sat, "initialize", init, 1);
  const stood = await rpc(
    sat,
    "tools/call",
    {
      name: "iskron_stand",
      arguments: { realm: "nks-dev", karta: 931, satellite_of: "@tester:lead" },
    },
    2,
  );
  assert.ok(!stood.result?.isError, JSON.stringify(stood));
  const id = await snapshotId(dir, sat.welcome.session);
  assert.ok(id, "the satellite's seat id in the snapshot");
  const r = await stop(dir, [sat.welcome.session], patOf(fake));
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.deepEqual(
    fake.state.orders.human.map((h) => [h.method, h.id]),
    [["POST", id]],
  );
});

// Полный адрес @handle:name называет и владельца места: место этой машины с тем же именем,
// но другим владельцем — не то место; отказ, ничего не отправлено.
test("stop @another:name refuses a seat of this machine named the same under another owner", async (t) => {
  const { dir, fake, id } = await seated(t, "proba");
  const r = await stop(dir, ["@other:proba"], patOf(fake));
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /@other:proba/, r.stderr);
  assert.match(r.stderr, /@tester:proba/, r.stderr);
  assert.equal(fake.state.orders.human.length, 0, "nothing is sent");
  const own = await stop(dir, ["@tester:proba"], patOf(fake));
  assert.equal(own.status, 0, `${own.stdout}\n${own.stderr}`);
  assert.deepEqual(
    fake.state.orders.human.map((h) => [h.method, h.id]),
    [["POST", id]],
  );
});

test("stop names no seat it does not see, and fails loudly", async (t) => {
  const { dir, fake } = await seated(t, "here");
  const r = await stop(dir, ["nobody"]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /ни сессии, ни места «nobody»/, r.stderr);
  assert.equal(fake.state.orders.human.length, 0, "nothing is sent");
});
