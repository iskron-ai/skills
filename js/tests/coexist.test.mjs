// Проба сосуществования поставок (граф @nks/nks-dev, узел #6815, часть гейта): ядро
// js/{bridge,shared,opencode,extension,watchdog,cli} копируется побайтово, слой
// js/delivery переписывается под продукт «other» с адресами example — и из того же
// ядра собирается другой мост: свой префикс окружения, свой дом, чужой шов.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";

import * as esbuild from "esbuild";

import { checkHello, helloFrame } from "../shared/seam.ts";
import { REPO } from "./built.mjs";

const CORE = ["bridge", "shared", "opencode", "extension", "watchdog", "cli"];
const SRC = join(REPO, "js");
const TMP = mkdtempSync(join(tmpdir(), "cx-"));
const COPY = join(TMP, "js");
const BRIDGE = join(TMP, "other.mjs");
const HOME = join(TMP, "home");

const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name === "README.md" ? [] : [join(dir, e.name)],
  );

/** Слой соседа: адреса — example, имя продукта во всех регистрах — other. */
function rewriteDelivery() {
  for (const f of files(join(COPY, "delivery"))) {
    const text = readFileSync(f, "utf8")
      .replaceAll("https://mcp.iskron.ru/", "https://mcp.example.org/")
      .replaceAll("https://mcp.iskron.ai/", "https://mcp.example.com/")
      .replaceAll("ISKRON", "OTHER")
      .replaceAll("Iskron", "Other")
      .replaceAll("iskron", "other")
      // The neighbour picks its own launch word (#6815 item 1).
      .replace('LAUNCH_WORD = "start"', 'LAUNCH_WORD = "start-other"');
    writeFileSync(f, text);
  }
}

const bundle = async (entry, outfile) => {
  await esbuild.build({
    entryPoints: [join(COPY, entry)],
    absWorkingDir: TMP,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["@earendil-works/pi-coding-agent"],
    outfile,
    logLevel: "silent",
  });
  return readFileSync(outfile, "utf8");
};

let bridgeText = "";
before(async () => {
  const notReadme = (p) => !p.endsWith("README.md");
  for (const d of [...CORE, "delivery"])
    cpSync(join(SRC, d), join(COPY, d), { recursive: true, filter: notReadme });
  rewriteDelivery();
  bridgeText = await bundle("cli/main.ts", BRIDGE);
});

after(() => rmSync(TMP, { recursive: true, force: true }));

/** Окружение другого моста: без переменных обеих поставок, кроме названных. */
function run(args, extra = {}) {
  const env = { ...process.env, HOME, OTHER_BRIDGE_NO_UPDATE: "1", ...extra };
  for (const k of Object.keys(env))
    if (/^(ISKRON|OTHER)_/.test(k) && !(k in extra) && k !== "OTHER_BRIDGE_NO_UPDATE")
      delete env[k];
  return spawnSync(process.execPath, [BRIDGE, ...args], { encoding: "utf8", env, timeout: 15_000 });
}

// A precondition of the probe, not evidence of portability: the other build below is
// made from exactly these core files (the real two-copy comparison is the neighbour's).
test("the probe's copy carries this repo's core files unchanged", () => {
  for (const d of CORE)
    for (const f of files(join(SRC, d))) {
      const rel = relative(SRC, f);
      assert.ok(
        readFileSync(join(COPY, rel)).equals(readFileSync(f)),
        `${rel} differs in the copy`,
      );
    }
});

test("the other bridge runs --version and --help under its own name", () => {
  const v = run(["--version"]);
  assert.equal(v.status, 0, v.stderr);
  assert.match(v.stdout, /^v\d+\.\d+\.\d+/);
  const h = run(["--help"]);
  assert.equal(h.status, 0, h.stderr);
  assert.match(h.stdout, /OTHER_BRIDGE_TOKEN/);
  assert.match(h.stdout, /other\.mjs/);
  assert.doesNotMatch(h.stdout + h.stderr, /iskron/i);
  assert.doesNotMatch(bridgeText, /iskron/i, "the bundle names no iskron");
  assert.match(bridgeText, /OTHER_/);
});

test("the other bridge keeps its home and ignores this delivery's auth-dir variable", () => {
  const daemonLine = (r) => r.stdout.split("\n").find((l) => l.startsWith("daemon")) ?? "";
  const own = run(["version"]);
  assert.equal(own.status, 0, own.stderr);
  assert.match(daemonLine(own), /\.other-bridge/);
  const foreign = run(["version"], { ISKRON_BRIDGE_AUTH_DIR: join(TMP, "foreign") });
  assert.equal(
    daemonLine(foreign),
    daemonLine(own),
    "ISKRON_BRIDGE_AUTH_DIR moved the other daemon",
  );
  const moved = run(["version"], { OTHER_BRIDGE_AUTH_DIR: join(TMP, "mine") });
  assert.notEqual(daemonLine(moved), daemonLine(own), "OTHER_BRIDGE_AUTH_DIR is not read");
});

test("the seam: the other thin bridge says hello as other, and this daemon refuses it", async () => {
  const out = join(TMP, "seam.mjs");
  await bundle("shared/seam.ts", out);
  const other = await import(pathToFileURL(out).href);
  const hello = other.helloFrame({ build: "x", path: BRIDGE, argv: [] });
  assert.equal(hello.product, "other");
  assert.match(checkHello(hello) ?? "", /delivery other/);
  assert.equal(checkHello(helloFrame({ build: "x", path: "p", argv: [] })), null);
});

// Two deliveries' plugins in one process (#6815 items 1, 3, 5): each stands by its own
// launch line, marks what it puts into the session, and lists only its own skills.
test("two deliveries in one process: neither reads the other's launch line, frames or skills", async () => {
  const load = async (entry) => {
    const out = join(TMP, `${entry.replaceAll("/", "-")}.mjs`);
    await bundle(entry, out);
    return import(pathToFileURL(out).href);
  };
  const [mine, other] = [
    {
      launch: await import("../shared/launch.ts"),
      frame: await import("../shared/frame-text.ts"),
      cmds: await import("../opencode/commands.ts"),
    },
    {
      launch: await load("shared/launch.ts"),
      frame: await load("shared/frame-text.ts"),
      cmds: await load("opencode/commands.ts"),
    },
  ];
  const ours = "start @nks/nks-dev #931 дело №5";
  const theirs = "start-other @acme/x #7 case #9";
  assert.equal(mine.launch.parseLaunch(ours)?.no, "5");
  assert.equal(mine.launch.parseLaunch(theirs), null, "this delivery reads the other's line");
  assert.equal(other.launch.parseLaunch(theirs)?.no, "9");
  assert.equal(other.launch.parseLaunch(ours), null, "the other delivery reads this line");

  assert.match(mine.frame.markFrame("№7 «Стенд»"), /^\[iskron\] №7/);
  assert.match(other.frame.markFrame("№7 «Стенд»"), /^\[other\] №7/);

  const roots = join(TMP, "skills");
  const listed = [];
  for (const [root, bridge, door] of [
    ["a", "iskron.mjs", "door-a"],
    ["b", "other.mjs", "door-b"],
  ]) {
    for (const id of ["establish-mcp", door]) {
      mkdirSync(join(roots, root, id, "scripts"), { recursive: true });
      const path = join(roots, root, id, "SKILL.md");
      writeFileSync(path, `---\nname: ${id}\nslash: true\ndescription: "x"\n---\n`);
      listed.push({ id, path, description: id });
    }
    writeFileSync(join(roots, root, "establish-mcp", "scripts", bridge), "");
  }
  const ids = (m) => m.cmds.skillCommands(listed).map((c) => c.id);
  assert.deepEqual(ids(mine), ["door-a", "establish-mcp"]);
  assert.deepEqual(ids(other), ["door-b", "establish-mcp"]);
});
