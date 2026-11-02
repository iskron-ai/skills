// prepare reads the holon and the agent role from the graph by origin (graph @nks/nks-dev, node
// #9325, item 2): the holon whose repository attribute names origin, its steward — two searches
// over MCP under the bridge's own key. Not one answer, no key or no server — nothing derived, the
// model's way stays. A stand-in MCP server on loopback; no real network.
//
// ISKRON_BRIDGE_PATH points the probe at any copy of the bridge.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

import { coverBlock } from "../shared/coverblock.ts";
import { BRIDGE, NODE } from "./status-kit.mjs";

const run = promisify(execFile);
const scratch = mkdtempSync(join(tmpdir(), "prepare-graph-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

// What the stand-in graph answers to a search, by its arguments; the calls it saw.
let answer = () => "Найдено 0 узлов.";
let stream = false;
const seen = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const msg = JSON.parse(body || "{}");
    seen.push({ auth: req.headers.authorization, session: req.headers["mcp-session-id"], msg });
    if (msg.id === undefined) return void res.writeHead(202).end();
    const result =
      msg.method === "initialize"
        ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "stand" } }
        : { content: [{ type: "text", text: answer(msg.params.arguments) }] };
    const reply = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result });
    res.setHeader("mcp-session-id", "sess-1");
    if (stream && msg.method === "tools/call") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      return void res.end(`event: message\ndata: ${reply}\n\n`);
    }
    res.writeHead(200, { "content-type": "application/json" }).end(reply);
  });
});
let url = "";
before(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server.close());

let n = 0;
async function repo() {
  const dir = join(scratch, `r${n++}`);
  mkdirSync(dir);
  await run("git", ["init", "-q", dir]);
  await run("git", ["-C", dir, "remote", "add", "origin", "git@github.com:acme/widget.git"]);
  return dir;
}

async function prepare(dir, args, extra = {}) {
  const env = {
    ...process.env,
    ISKRON_BRIDGE_NO_UPDATE: "1",
    ISKRON_BRIDGE_LANG: "ru",
    ISKRON_BRIDGE_AUTH_DIR: join(scratch, "auth"),
    ISKRON_BRIDGE_URL: url,
    ISKRON_BRIDGE_TOKEN: "pat-probe",
    ...extra,
  };
  const r = await run(NODE, [BRIDGE, "prepare", "--dir", dir, "--json", ...args], { env }).catch(
    (e) => e,
  );
  return { code: r.code ?? 0, out: JSON.parse(r.stdout || "null") };
}

const graphOf = (args) =>
  args.node_type === "holon" && args.attrs_filter === "repository:github.com/acme/widget"
    ? "Найдено 1 узлов:\n  📦 widget (#12, holon, Pt/Va/Ad, v3) — Граница: репозиторий…"
    : args.node_type === "karta" && args.steward_of === "12"
      ? "Найдено 1 узлов:\n  👨‍💻 Widget Dev (#34, karta 能, Pt/Va/Up, v9) — Держит…"
      : "Найдено 0 узлов.";
const cover = (dir) =>
  Object.fromEntries(coverBlock(readFileSync(join(dir, "AGENTS.md"), "utf8"), "iskron"));

test("контур по атрибуту repository и его стюард — в обложку, под ключом моста", async () => {
  answer = graphOf;
  seen.length = 0;
  const dir = await repo();
  const { out } = await prepare(dir, ["--graph", "r7"]);
  assert.deepEqual(out.derived, { holon: "12", agent_role: "34" });
  assert.deepEqual(cover(dir), { graph: "r7", holon: "12", agent_role: "34" });
  const calls = seen.filter((s) => s.msg.method === "tools/call").map((s) => s.msg.params);
  assert.deepEqual(
    calls.map((c) => [c.name, c.arguments.realm]),
    [
      ["iskron_search", "r7"],
      ["iskron_search", "r7"],
    ],
  );
  assert.ok(seen.every((s) => s.auth === "Bearer pat-probe"));
  assert.ok(
    seen.slice(1).every((s) => s.session === "sess-1"),
    "один сеанс MCP",
  );
});

test("--lang держится после чтения графа: настройка сервера языка не меняет", async () => {
  answer = graphOf;
  const dir = await repo();
  const extra = {
    ISKRON_BRIDGE_LANG: "",
    ISKRON_BRIDGE_URL: url.replace("127.0.0.1", "localhost"),
  };
  const { out } = await prepare(dir, ["--graph", "r7", "--lang", "en"], extra);
  assert.match(out.left.find((x) => x.item === "cover.contract")?.why ?? "", /^no contract named/);
  const s = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf8"));
  assert.match(s.hooks.PreToolUse[0].hooks[0].command, /BLOCKED: local agent memory/);
});

test("ответ потоком событий читается так же", async () => {
  answer = graphOf;
  stream = true;
  try {
    const dir = await repo();
    assert.deepEqual((await prepare(dir, ["--graph", "r7"])).out.derived, {
      holon: "12",
      agent_role: "34",
    });
  } finally {
    stream = false;
  }
});

test("контур назван — спрошен только стюард; два кандидата — ничего не выведено", async () => {
  answer = graphOf;
  seen.length = 0;
  const dir = await repo();
  const given = await prepare(dir, ["--graph", "r7", "--holon", "12"]);
  assert.deepEqual(given.out.derived, { agent_role: "34" });
  assert.equal(seen.filter((s) => s.msg.method === "tools/call").length, 1);
  answer = () => "Найдено 2 узлов:\n  a (#12, holon, …)\n  b (#13, holon, …)";
  const two = await repo();
  const { code, out } = await prepare(two, ["--graph", "r7"]);
  assert.deepEqual(out.derived, {});
  assert.equal(code, 3);
  assert.ok(out.left.some((x) => x.item === "cover.holon"));
});

test("сервер недоступен или ключа нет — как раньше: адреса модели", async () => {
  for (const extra of [{ ISKRON_BRIDGE_URL: "http://127.0.0.1:9/" }, { ISKRON_BRIDGE_TOKEN: "" }]) {
    const dir = await repo();
    const { code, out } = await prepare(dir, ["--graph", "r7"], extra);
    assert.equal(code, 3, JSON.stringify(extra));
    assert.deepEqual(out.derived, {});
    for (const f of ["cover.holon", "cover.agent_role"])
      assert.ok(
        out.left.some((x) => x.item === f),
        f,
      );
  }
});
