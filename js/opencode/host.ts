// Что хост плагина — сам OpenCode — говорит о себе и о сессии, для половины
// «тулы» (tools.ts). Из plugin.ts здесь только тип — рантайм-цикла импорта нет.
import { HARNESS_VERSION_ENV, SKILLS_ROOT_ENV } from "../shared/clients.ts";
import type { Context } from "./plugin.ts";
import type { Home } from "./records.ts";
import { bridgeRoot } from "./skillread.ts";

/**
 * Что мост узнаёт о хосте только окружением (#6226). Версия самого OpenCode:
 * клиент рукопожатия — этот плагин, и его clientInfo.version не версия хоста;
 * нет app — ничего не объявляем. Корень набора: мост плагина — домашняя копия
 * вне набора, а набор — тот, где OpenCode загрузил скилл моста с мостом в scripts/
 * (ctx.skill.list(); признак — bridgeRoot в skillread.ts); такого нет — корня не называем.
 */
export async function hostEnvOf(ctx: Context): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  const v = (ctx as { app?: { version?: unknown } | null }).app?.version;
  if (typeof v === "string" && v.trim()) env[HARNESS_VERSION_ENV] = v.trim();
  try {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- ответ хоста без схемы */
    const res: any = await ctx.skill.list();
    const list: unknown[] = Array.isArray(res) ? res : (res?.data ?? []);
    const root = list.map(bridgeRoot).find((r) => r !== null);
    if (root) env[SKILLS_ROOT_ENV] = root;
  } catch {
    /* список скиллов не прочитался — мост найдёт набор сам или скажет "unknown" */
  }
  return env;
}

/**
 * Локация этого экземпляра плагина — ctx.location (@opencode/plugin 2.0.4):
 * OpenCode грузит плагин по разу на локацию, и маркер потери метится ею (marker.ts).
 */
export function homeOf(ctx: Context): Home | null {
  const loc = (ctx as { location?: { directory?: unknown; workspaceID?: unknown } }).location;
  if (typeof loc?.directory !== "string" || !loc.directory) return null;
  const workspace = typeof loc.workspaceID === "string" ? loc.workspaceID : null;
  return { directory: loc.directory, workspace };
}

/**
 * Директория сессии — рабочая копия, над которой идёт ход: у SessionInfo
 * OpenCode 2 она в location.directory (@opencode/plugin 2.0.4). Нет её —
 * пусто, мост выведет из своего cwd.
 */
export async function sessionDirectory(ctx: Context, sessionID: string): Promise<string | null> {
  try {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- ответ хоста без схемы */
    const res: any = await ctx.session.get({ sessionID } as any);
    const dir = res?.location?.directory ?? res?.data?.location?.directory;
    return typeof dir === "string" && dir.trim() ? dir : null;
  } catch {
    return null;
  }
}
