import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { seatID } from "./stand-recall-evidence.mjs";

// These transport journals can contain credentials even when auth directories are gone.
// Retained evidence is the scrubbed report, not these intermediate files.
export function removeRawLogs(run) {
  for (const name of ["bridge.jsonl", "api.out", "serve.log"])
    rmSync(join(run, name), { force: true });
}

export function runCleanup({ run, auth, bridge, env, cwd, report, scrub, problem }) {
  const dirs = [auth, join(run, "auth-person")];
  const daemonPids = new Set();
  const snapshots = [];
  function places() {
    const result = [];
    for (const dir of dirs) {
      const r = spawnSync(process.execPath, [bridge, "status", "--json", "--auth-dir", dir], { env, cwd, encoding: "utf8", timeout: 30_000 });
      let s = {};
      try { s = JSON.parse(r.stdout); } catch { problem(`cleanup: status unavailable for ${dir}`); }
      if (s.daemon?.pid) daemonPids.add(s.daemon.pid);
      if (r.status !== 0 || (s.daemon && !s.snapshot_available)) problem(`cleanup: incomplete status for ${dir}`);
      result.push(...(s.sessions ?? []).flatMap((x) => x.places ?? []), ...(s.disk_only ?? []).filter((p) => !p.left));
      const records = join(dir, "standings");
      if (existsSync(records)) for (const f of readdirSync(records).filter((f) => f.endsWith(".hold"))) {
        try {
          const p = JSON.parse(readFileSync(join(records, f), "utf8"));
          if (p.name && p.realm && p.karta && !p.left) result.push(p);
        } catch { problem(`cleanup: unreadable standing record ${join(records, f)}`); }
      }
    }
    return result;
  }
  function capture(phase) {
    const logs = [];
    for (const dir of dirs) for (const name of ["grant.log.1", "grant.log", "standings.log.1", "standings.log"]) {
      const path = join(dir, name);
      try { logs.push({ path, present: existsSync(path), text: existsSync(path) ? scrub(readFileSync(path, "utf8")) : "" }); }
      catch { problem(`lifecycle journal unreadable: ${path}`); }
    }
    snapshots.push({ phase, logs });
    report.push(`--- lifecycle ${phase} ---\n${JSON.stringify(logs, null, 2)}`);
  }
  async function revoke(owned, P, person) {
    let pending = [...new Map(owned.map((p) => [`${p.realm}:${p.karta}:${p.name}`, p])).values()];
    for (let pass = 0; pending.length && pass <= owned.length; pass++) {
      const retry = [];
      for (const p of pending) try {
        const karta = String(p.karta).replace(/^#/, "");
        const board = await P.call("iskron_channel", { realm: p.realm, action: "list", karta: `#${karta}` });
        if (board.error) throw new Error("board unavailable");
        const id = seatID(board.text, p.name);
        if (!id && board.text.includes(`:${p.name}`)) throw new Error("seat ID not parsed");
        if (id) {
          const r = await person.revoke(p.realm, id);
          if (r.error) throw new Error(r.text);
          report.push(`cleanup: revoked ${p.realm} #${karta} ${p.name} id ${id}`);
        }
      } catch (e) { retry.push({ ...p, error: e.message }); }
      if (retry.length === pending.length) { pending = retry; break; }
      pending = retry;
    }
    for (const p of pending) problem(`seat ${p.name}: ${p.error}`);
  }
  async function stopDaemons() {
    for (const pid of daemonPids) if (Number.isInteger(pid) && pid > 1) {
      try { process.kill(pid, "SIGTERM"); } catch (e) { if (e.code !== "ESRCH") problem(`daemon ${pid}: ${e.code}`); }
    }
    await new Promise((r) => setTimeout(r, 4500));
    for (const pid of daemonPids) try {
      process.kill(pid, 0);
      process.kill(pid, "SIGKILL");
      problem(`daemon ${pid} required SIGKILL`);
    } catch (e) { if (e.code !== "ESRCH") problem(`daemon ${pid}: ${e.code}`); }
  }
  return { places, capture, revoke, stopDaemons, snapshots };
}
