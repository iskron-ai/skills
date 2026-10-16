// First prompt only; the whole read, including host metadata, has one ceiling.
import { envName, ONBOARD_START } from "../delivery/index.ts";
import { readCover } from "../shared/cover.ts";
import { words } from "../shared/lang.ts";
import { type OnboardCall, wizardDue } from "../shared/onboardstart.ts";
import type { Context } from "./plugin.ts";

export function createOnboardStart(
  ctx: Context,
  call: (session: string) => OnboardCall,
  child: (session: string) => boolean = () => false,
  halted: (session: string) => boolean = () => false,
) {
  const seen = new Set<string>();
  const configured = Number(process.env[envName("ONBOARD_START_MS")] || 4000);
  const ms = Number.isFinite(configured) && configured > 0 ? Math.min(configured, 5000) : 4000;
  return {
    forget: (session: string): void => {
      seen.delete(session);
    },
    async prompt(session: string): Promise<string | null> {
      if (seen.has(session) || child(session) || halted(session)) return null;
      seen.add(session);
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const ceiling = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(null);
        }, ms);
      });
      const read = async (): Promise<string | null> => {
        const response = await ctx.session.get({ sessionID: session } as never);
        // Both SDK response shapes are in use. An unreadable session is not a root.
        const raw = response as unknown as {
          id?: string;
          parentID?: string;
          location?: { directory?: string };
          data?: unknown;
        };
        const info = (raw?.data ?? raw) as typeof raw;
        if (!info?.id || info.parentID || !info.location?.directory) return null;
        if (readCover(info.location.directory) !== null || halted(session)) return null;
        controller.signal.throwIfAborted();
        return (await wizardDue(call(session), controller.signal)) && !halted(session)
          ? words(ONBOARD_START).start()
          : null;
      };
      try {
        return await Promise.race([read().catch(() => null), ceiling]);
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    },
  };
}
