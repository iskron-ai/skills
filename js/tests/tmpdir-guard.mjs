// Keep writing probes out of real parent repositories (graph @nks/nks-dev, #10310).
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function assertExternalTmpdir() {
  const scratch = realpathSync(tmpdir());
  for (let dir = scratch; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) {
      throw new Error(`Unsafe TMPDIR ${scratch}: inside repository ${dir}; use external scratch`);
    }
    if (dirname(dir) === dir) return;
  }
}
