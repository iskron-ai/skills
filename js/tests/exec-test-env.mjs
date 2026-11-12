import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fakeOpenCode, fakeOrca } from "./exec-fake-orca.mjs";

export function execTestEnvironment() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "exec-test-")));
  const auth = join(root, "auth");
  mkdirSync(auth);
  mkdirSync(join(root, "checkout"));
  mkdirSync(join(root, "bin"));
  for (const [name, script] of [
    ["orca", fakeOrca],
    ["opencode", fakeOpenCode],
  ]) {
    writeFileSync(join(root, "bin", name), script);
    chmodSync(join(root, "bin", name), 0o700);
  }
  const oldPath = process.env.PATH,
    oldRoot = process.env.EXEC_TEST_ROOT;
  process.env.PATH = `${root}/bin:${oldPath}`;
  process.env.EXEC_TEST_ROOT = root;
  return {
    root,
    auth,
    restore: () => {
      process.env.PATH = oldPath;
      if (oldRoot === undefined) delete process.env.EXEC_TEST_ROOT;
      else process.env.EXEC_TEST_ROOT = oldRoot;
      rmSync(root, { recursive: true, force: true });
    },
  };
}
