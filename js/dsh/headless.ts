// Whether this dsh process is a one-shot headless run (graph @nks/nks-dev, node #11071): it exits
// at its first idle, so the word after the turn goes through a task holding that idle (hold.ts);
// out of headless no task — it would hold a human's input. Two signs, either suffices: the headless
// app's own service `headlessStartup`, read with Cordis's ctx.get, which needs no inject (types of
// the installed @deepseek-ai/dsh-headless 0.2.2-rc.1, startup.d.ts; cordis reflect.d.ts) — observed
// present on agent/created, absent on apply; and the launcher's profile in the process's argv —
// `dsh headless …` or `dsh --profile headless …`, the shape the orchestrator launches
// (bridge/orchestra-dsh.ts).
/* eslint-disable @typescript-eslint/no-explicit-any -- the Cordis context without a schema */

/** The launcher's profile in argv (after node and the script): `dsh NAME` or `--profile NAME`. */
export function profileOf(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] ?? "";
    if (t === "--profile") return argv[i + 1] ?? null;
    if (t.startsWith("--profile=")) return t.slice("--profile=".length);
    if (t === "--patch") i++;
    else if (!t.startsWith("-")) return t;
  }
  return null;
}

export function isHeadless(ctx: any, argv: readonly string[] = process.argv.slice(2)): boolean {
  try {
    if (typeof ctx?.get === "function" && ctx.get("headlessStartup", false) !== undefined)
      return true;
  } catch {
    /* the service registry is not ours to break */
  }
  return profileOf(argv) === "headless";
}

/* eslint-enable @typescript-eslint/no-explicit-any */
