// What the plugin's host — OpenCode itself — says about itself and the session, for the
// "tools" half (tools.ts). Only a type comes from plugin.ts — no runtime import cycle.
import { HARNESS_VERSION_ENV, SKILLS_ROOT_ENV } from "../shared/clients.ts";
import type { Context } from "./plugin.ts";
import type { Home } from "./records.ts";
import { bridgeRoot } from "./skillread.ts";

/**
 * What the bridge learns of the host only by environment (#6226): OpenCode's own version (the
 * handshake's client is this plugin, not the host), and the set's root — where OpenCode loaded
 * the bridge skill with the bridge in scripts/ (bridgeRoot in skillread.ts); none — not named.
 */
export async function hostEnvOf(ctx: Context): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  const v = (ctx as { app?: { version?: unknown } | null }).app?.version;
  if (typeof v === "string" && v.trim()) env[HARNESS_VERSION_ENV] = v.trim();
  try {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- the host's answer has no schema */
    const res: any = await ctx.skill.list();
    const list: unknown[] = Array.isArray(res) ? res : (res?.data ?? []);
    const root = list.map(bridgeRoot).find((r) => r !== null);
    if (root) env[SKILLS_ROOT_ENV] = root;
  } catch {
    /* the skill list was not read — the bridge finds the set itself or says "unknown" */
  }
  return env;
}

/**
 * Whether the host's session.update takes `archived` — OpenCode 2.2 on (graph @nks/nks-dev,
 * node #9257); the plugin has no exit of the TUI on any version.
 */
export function archives(ctx: Context): boolean {
  const v = (ctx as { app?: { version?: unknown } | null }).app?.version;
  const m = typeof v === "string" ? /^(\d+)\.(\d+)/.exec(v) : null;
  return !!m && (Number(m[1]) > 2 || (Number(m[1]) === 2 && Number(m[2]) >= 2));
}

/**
 * The stopped session archived (`on`) or taken out of the archive (#9256) — archived, not
 * removed: the human reads what the agent got to. An archive not made is said by `leftOpen`:
 * why — the host's refusal, null — the host cannot archive.
 */
export function archiver(
  ctx: Context,
  leftOpen: (id: string, why: string | null) => void,
): (id: string, on: boolean) => Promise<void> {
  const session = ctx.session as unknown as { update?: (o: object) => Promise<unknown> };
  return async (id, on) => {
    if (!archives(ctx) || typeof session.update !== "function")
      return void (on && leftOpen(id, null));
    try {
      await session.update({ sessionID: id, archived: on });
    } catch (e) {
      if (on) leftOpen(id, (e as Error).message);
    }
  };
}

/** This plugin instance's location — ctx.location (@opencode/plugin 2.0.4); the loss marker is tagged by it (marker.ts). */
export function homeOf(ctx: Context): Home | null {
  const loc = (ctx as { location?: { directory?: unknown; workspaceID?: unknown } }).location;
  if (typeof loc?.directory !== "string" || !loc.directory) return null;
  const workspace = typeof loc.workspaceID === "string" ? loc.workspaceID : null;
  return { directory: loc.directory, workspace };
}

/** The session's directory — the working copy of its turn (location.directory); none — empty, the bridge uses its cwd. */
export async function sessionDirectory(ctx: Context, sessionID: string): Promise<string | null> {
  try {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- the host's answer has no schema */
    const res: any = await ctx.session.get({ sessionID } as any);
    const dir = res?.location?.directory ?? res?.data?.location?.directory;
    return typeof dir === "string" && dir.trim() ? dir : null;
  } catch {
    return null;
  }
}
