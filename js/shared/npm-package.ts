// npm layout and version ownership: nks-dev #4901.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function packageRoot(): string | null {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  try {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return manifest.name === "@iskron/opencode" ? root : null;
  } catch {
    return null; // The standalone copy has no npm package around it.
  }
}
