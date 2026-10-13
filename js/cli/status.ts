// Sessionless, read-only machine inspection (graph @nks/nks-dev, node #7495).
import { BUILD } from "../bridge/build.ts";
import { envName, MACHINE_STATUS } from "../delivery/index.ts";
import { setLang, words } from "../shared/lang.ts";
import { connectSeam, helloFrame } from "../shared/seam.ts";
import { seamEntranceProblem, seamSocketPath } from "../shared/seam-entrance.ts";
import { type MachineSnapshot, safeSnapshot } from "../shared/snapshot.ts";
import { defaultAuthDir } from "../shared/standings.ts";
import {
  type DiskPlace,
  diskPlaces,
  type FallbackSnapshot,
  fallbackSnapshot,
} from "./statusdisk.ts";

interface StatusSnapshot {
  daemon: MachineSnapshot["daemon"] | null;
  sessions: MachineSnapshot["sessions"];
  snapshot_available: boolean;
  fallback: FallbackSnapshot[];
  disk_only: DiskPlace[];
}
async function machine(
  authDir: string,
): Promise<Pick<StatusSnapshot, "daemon" | "sessions" | "snapshot_available">> {
  if (!seamEntranceProblem(authDir)) {
    try {
      const link = await connectSeam(
        seamSocketPath(authDir),
        {
          ...helloFrame({ build: BUILD, path: "", argv: [], probe: true }),
          env: {},
          snapshot: true,
        },
        3000,
      );
      const w = link.welcome;
      link.close();
      if (w.snapshot) return { ...safeSnapshot(w.snapshot), snapshot_available: true };
      return {
        daemon: safeSnapshot({ daemon: w }).daemon,
        sessions: [],
        snapshot_available: false,
      };
    } catch {
      /* No error details: wire errors can contain private addresses. */
    }
  }
  return { daemon: null, sessions: [], snapshot_available: false };
}
const printable = (v: string | number): string =>
  [...String(v)]
    .map((c) =>
      c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159) ? " " : c,
    )
    .join("");
function render(s: StatusSnapshot): string {
  const w = words(MACHINE_STATUS);
  const d = s.daemon;
  const lines = [
    d ? `${w.daemon()}: pid=${d.pid} ${printable(d.build)} ${printable(d.path)}` : w.absent(),
  ];
  if (d && !s.snapshot_available) lines.push(w.unavailable());
  if (!d || s.snapshot_available) lines.push(`${w.sessions()}: ${s.sessions.length}`);
  for (const session of s.sessions) {
    lines.push(
      `  ${printable(session.local_id)} pid=${session.thin_pid} ${session.attached ? w.attached() : w.detached()} ${printable(session.harness)} ${printable(session.harness_session ?? "-")} ${printable(session.build)} ${printable(session.cwd)}`,
    );
    for (const p of session.places) {
      const mode = p.satellite_of
        ? `${w.satellite()} ${printable(p.satellite_of)}`
        : p.primary
          ? w.primary()
          : w.beside();
      lines.push(
        `    ${printable(p.name)} ${printable(p.realm)} #${printable(p.karta)} ${mode} · ${p.listening ? w.listening() : w.silent()} · ${w.lastWork()}: ${printable(p.last_work_at ?? w.unknown())}${p.usage ? ` · usage=${JSON.stringify(p.usage)}` : ""}`,
      );
    }
  }
  lines.push(`${w.fallback()}: ${s.fallback.length}`);
  for (const f of s.fallback)
    lines.push(`  pid=${f.pid} ${printable(f.build)} ${printable(f.cwd)}`);
  lines.push(`${w.disk()}: ${s.disk_only.length}`);
  for (const p of s.disk_only)
    lines.push(
      `  ${printable(p.name)} ${printable(p.realm)} #${printable(p.karta)} — ${w.record()}`,
    );
  return lines.join("\n") + "\n";
}
export async function runStatus(args: string[]): Promise<void> {
  const i = args.indexOf("--auth-dir");
  const authDir =
    (i >= 0 ? args[i + 1] : undefined) ||
    process.env[envName("BRIDGE_AUTH_DIR")] ||
    defaultAuthDir();
  setLang(args[args.indexOf("--lang") + 1]);
  const snapshot = {
    ...(await machine(authDir)),
    fallback: fallbackSnapshot(authDir),
    disk_only: await diskPlaces(authDir),
  };
  process.stdout.write(
    args.includes("--json") ? JSON.stringify(snapshot, null, 2) + "\n" : render(snapshot),
  );
}
