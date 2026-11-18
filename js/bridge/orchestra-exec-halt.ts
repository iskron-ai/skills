// A native exec launch's session on the shared OpenCode server, halted by the daemon the way the
// plugin halts a session on a confirmed stop (graph @nks/nks-dev, #9256, #11099; the plugin's
// cut and archive — opencode/cuts.ts, opencode/host.ts): its turn interrupted without resume,
// the session archived, and the archive read back — only the read-back confirms. The calls go
// through `opencode api` against the run's own server, as the launch's preparation does.
import { type ApiCall, execApi } from "./exec-prepare.ts";

const data = (v: unknown): Record<string, unknown> =>
  (v as { data?: Record<string, unknown> } | null)?.data ?? {};

/** null — halted and archived, read back; otherwise the step that did not confirm. */
export async function haltExecSession(
  server: string,
  session: string,
  api: ApiCall = execApi,
): Promise<string | null> {
  const path = `/api/session/${encodeURIComponent(session)}`;
  try {
    const cut = data(await api(server, "post", `${path}/interrupt?resume=false`));
    if (typeof cut.interrupted !== "boolean") return "session_interrupt_unconfirmed";
  } catch {
    return "session_halt_unknown";
  }
  // The update answers without content: its own answer proves nothing, the read-back does.
  await api(server, "patch", path, { archived: true }).catch(() => {});
  try {
    const s = data(await api(server, "get", path));
    const time = s.time as { archived?: unknown } | undefined;
    return s.id === session && !!time?.archived ? null : "session_archive_unconfirmed";
  } catch {
    return "session_halt_unknown";
  }
}
