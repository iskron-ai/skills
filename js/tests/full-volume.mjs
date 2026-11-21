// A real volume of this machine below the recommended floor (10% free), or null: devfs on macOS
// has nothing free. The probes of "the floor is off by default" read it, never fill a disk.
import { statfsSync } from "node:fs";

const CANDIDATES = ["/dev"];

export function fullVolume() {
  for (const path of CANDIDATES) {
    try {
      const s = statfsSync(path);
      const total = Number(s.blocks) * Number(s.bsize);
      if (total > 0 && (Number(s.bavail) * Number(s.bsize) * 100) / total < 10) return path;
    } catch {
      /* not this one */
    }
  }
  return null;
}
