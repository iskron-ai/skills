// A launch's terminal is not closed while its client still holds a live seat through this
// daemon — any seat, not only the call's (8.14.1 on a machine: the call's seat was over, the same
// OpenCode process had stood another place, and the reap killed a live agent). What the daemon
// knows itself: its thin bridges' sessions with a seat standing, by the bridge's pid; a bridge
// started by a client inside an Orca terminal inherits that terminal's handle in its environment.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

/** A live session of this daemon: its thin bridge's pid and the seats it stands. */
export interface SeatHolder {
  pid: number;
  seats: string[];
}
/** The seat a client inside this terminal holds through the daemon; null — none. */
export type Held = (terminal: string) => Promise<string | null>;

export const noHeld: Held = () => Promise.resolve(null);

const KEY = "ORCA_TERMINAL_HANDLE=";

/** The environment of a process of this user: /proc on Linux, `ps eww` elsewhere. */
const environOf = (pid: number): Promise<string[] | null> =>
  process.platform === "linux"
    ? readFile(`/proc/${pid}/environ`, "utf8").then(
        (s) => s.split("\0"),
        () => null,
      )
    : new Promise((done) =>
        execFile(
          "ps",
          ["eww", "-o", "command=", "-p", String(pid)],
          { windowsHide: true, timeout: 5_000 },
          (e, out) => done(e ? null : String(out).split(/\s+/)),
        ),
      );

/** The Orca terminal a process was started in; null — none seen, or unreadable. */
export async function terminalOf(pid: number): Promise<string | null> {
  const found = (await environOf(pid))?.find((s) => s.startsWith(KEY));
  return found ? found.slice(KEY.length) : null;
}

/** Whether a live seat stands in this terminal, by the daemon's own sessions. */
export const heldBy =
  (holders: () => SeatHolder[], terminalOfPid = terminalOf): Held =>
  async (terminal) => {
    for (const h of holders())
      if (h.seats.length && (await terminalOfPid(h.pid)) === terminal) return h.seats[0]!;
    return null;
  };
