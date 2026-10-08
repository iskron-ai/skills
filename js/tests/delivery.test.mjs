// Слой поставки (граф @nks/nks-dev: #6806, #6809): версия и метка канала — одним
// источником в js/delivery/version.ts. Его штампует release-please, из него читает
// сборщик, его несёт собранный мост.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { HOME_BRIDGE_FILE, HOME_DIR, SATELLITE_CODE } from "../delivery/product.ts";
import { versionIn } from "../shared/version.ts";
import { BUILT_BRIDGE, REPO } from "./built.mjs";

const SOURCE = "js/delivery/version.ts";
const read = (rel) => readFileSync(join(REPO, rel), "utf8");
const source = read(SOURCE);

function tsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === "node_modules"
        ? []
        : tsFiles(join(dir, e.name))
      : e.name.endsWith(".ts")
        ? [join(dir, e.name)]
        : [],
  );
}

test("release-please stamps the version in the delivery layer and nowhere else in js/", () => {
  const config = JSON.parse(read("release-please-config.json"));
  const generic = config.packages["."]["extra-files"]
    .filter((f) => f.path.startsWith("js/"))
    .map((f) => f.path);
  assert.deepEqual(generic, [SOURCE]);
  assert.match(source, /^export const VERSION = "\d+\.\d+\.\d+"; \/\/ x-release-please-version$/m);
  const stamped = tsFiles(join(REPO, "js")).filter((f) =>
    readFileSync(f, "utf8").includes("x-release-please-version"),
  );
  assert.deepEqual(stamped, [join(REPO, SOURCE)]);
});

test("the built bridge carries the delivery layer's version and dev channel mark", () => {
  const version = /^export const VERSION = "([^"]+)"/m.exec(source)[1];
  const mark = /^export const CHANNEL_MARK: string = "([^"]+)";$/m.exec(source)[1];
  const name = /^export const BUILD_MARK = "([^"]+)";$/m.exec(source)[1];
  assert.equal(mark, `${name}:dev`);
  const plugin = JSON.parse(read(".claude-plugin/plugin.json"));
  assert.equal(version, plugin.version);
  const bridge = readFileSync(BUILT_BRIDGE, "utf8");
  assert.match(bridge, new RegExp(`^var VERSION = "${version.replaceAll(".", "\\.")}";`, "m"));
  assert.ok(bridge.includes(`"${mark}"`), `the dev bridge must carry ${mark}`);
});

test("versionIn does not read another delivery's bridge: its channel mark names another build", () => {
  const text = (mark) => `const VERSION = "9.9.9";\n${mark ? `var CHANNEL_MARK = "${mark}";` : ""}`;
  assert.equal(versionIn(text("other-build:release")), null, "another product's release");
  assert.equal(versionIn(text("other-build:dev")), null, "another product's dev build");
  assert.equal(versionIn(text("iskron-build:release")), "9.9.9", "this product's release");
  assert.equal(versionIn(text("iskron-build:dev")), "9.9.9", "this product's dev build");
  assert.equal(versionIn(text("")), "9.9.9", "an old release without a mark");
});

test("the satellite entry code launches this delivery's home bridge", () => {
  assert.ok(
    SATELLITE_CODE.includes(`homedir(),'${HOME_DIR}','${HOME_BRIDGE_FILE}')`),
    `SATELLITE_CODE must join ${HOME_DIR}/${HOME_BRIDGE_FILE}: ${SATELLITE_CODE}`,
  );
});
