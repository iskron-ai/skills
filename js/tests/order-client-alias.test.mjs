// Exact own-Run binding (#9256): realm aliases require this session's learnt relation.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseArgs, setConfig } from "../bridge/config.ts";
import { H } from "../bridge/holdstate.ts";
import { boundStop } from "../bridge/order-client.ts";
import { learnRealm } from "../bridge/realms.ts";
import { state } from "../bridge/transport.ts";
import { newScope, runIn } from "../shared/scope.ts";
import { until } from "./ownseat-kit.mjs";

const CANON = "@nks/nks-dev";
for (const mode of [
  "short-run",
  "short-seat",
  "foreign",
  "unknown",
  "other-scope",
  "foreign-standing",
  "foreign-runtime",
  "foreign-incarnation",
  "replaced-runtime",
  "replaced-incarnation",
  "ambiguous",
  "superseded-after-exit",
]) {
  test(`own Run alias boundary: ${mode}`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "iskron-order-alias-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, "bin"));
    mkdirSync(join(dir, "run"));
    writeFileSync(
      join(dir, "bin/orca"),
      `#!/bin/sh\nexec "${process.execPath}" "${new URL("./fake-orca.mjs", import.meta.url).pathname}" "$@"\n`,
      { mode: 0o755 },
    );
    const gate = join(dir, "wait-held");
    const log = join(dir, "orca.log");
    const env = {
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      FAKE_ORCA_LOG: log,
      FAKE_ORCA_WAIT_HOLD: gate,
      FAKE_ORCA_WAIT_EXIT: "1",
    };
    const old = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    Object.assign(process.env, env);
    t.after(() => {
      for (const [k, v] of Object.entries(old)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
    const scope = newScope(mode, { env: {}, cwd: dir, pid: process.pid, path: "" }, () => false);
    await runIn(scope, async () => {
      setConfig(parseArgs(["http://127.0.0.1:9/mcp", "--auth-dir", dir]));
      if (!["unknown", "other-scope"].includes(mode)) learnRealm("r5", CANON);
      if (mode === "other-scope")
        runIn(
          newScope(
            "foreign-session",
            {
              env: {},
              cwd: dir,
              pid: process.pid,
              path: "",
            },
            () => false,
          ),
          () => learnRealm("r5", CANON),
        );
      state.standing = { realm: mode === "short-seat" ? "r5" : CANON };
      const own = {
        realm: mode === "short-seat" ? CANON : mode === "foreign" ? "@nks/foreign" : "r5",
        room: "room",
        invite: 1,
        karta: 931,
        launcher: "own",
        harness: "opencode",
        model: "unused",
        repository: "local",
        worktree: dir,
        terminal: "term_owned",
        runtime: mode === "foreign-runtime" ? "rt_foreign" : "rt_fake",
        standing_id: mode === "foreign-standing" ? "foreign-standing" : "own-standing",
        state: "raised",
        at: "now",
      };
      if (mode.includes("incarnation")) own.exec = { incarnation: "inc_foreign" };
      const registry = join(dir, "run/orchestra-runs.json");
      const rows = {
        own,
        neighbour: { ...own, realm: "@nks/foreign", terminal: "term_neighbour" },
      };
      if (mode === "ambiguous") rows.duplicate = { ...own, realm: CANON };
      const save = () => writeFileSync(registry, JSON.stringify({ runs: rows }));
      const argv = () => {
        try {
          return readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
        } catch {
          return [];
        }
      };
      save();
      const finish = boundStop("own-standing");
      H.stopped.n++;
      state.standing = null;
      if (mode.startsWith("replaced-")) {
        if (mode === "replaced-runtime") own.runtime = "rt_replaced";
        else own.exec.incarnation = "inc_replaced";
        save();
      }
      if (mode === "superseded-after-exit") writeFileSync(gate, "held");
      const result = finish("client_unbound");
      if (mode === "superseded-after-exit") {
        await until(() => argv().some((a) => a[1] === "wait"), "exact client's wait barrier");
        H.stopped.n++;
        rmSync(gate);
      }
      const expected = ["short-run", "short-seat"].includes(mode)
        ? null
        : mode.startsWith("replaced-") || mode === "superseded-after-exit"
          ? "stop_superseded"
          : mode === "foreign-runtime"
            ? "terminal_binding_unconfirmed"
            : mode === "foreign-incarnation"
              ? "terminal_binding_changed"
              : "client_unbound";
      assert.equal(await result, expected);
      const closed = ["short-run", "short-seat", "superseded-after-exit"].includes(mode);
      assert.equal(argv().filter((a) => a[1] === "close").length, closed ? 1 : 0);
      const stored = JSON.parse(readFileSync(registry, "utf8")).runs;
      assert.equal(stored.own.closed, closed ? "client_exited" : undefined);
      assert.deepEqual(
        stored.neighbour,
        rows.neighbour,
        "foreign graph untouched despite same standing",
      );
      assert.ok(
        argv().every((a) => a[3] === "term_owned"),
        "no neighbour handle addressed",
      );
    });
  });
}
