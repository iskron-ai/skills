// Сессия и локация экземпляра плагина (граф nks-dev: #6550, правило 3; #6626).
// OpenCode грузит плагин по разу на локацию, и тулы сессии идут через экземпляр её
// локации. Сессию переносят между папками (событие session.moved, data.location):
// ушла отсюда — мост корня гасится, запись держания цела, и место берёт мост
// экземпляра новой папки по сессии (bridge/resume.ts); пришла сюда — место с диска
// сразу, не ждя её вызова (#6137), с терпением к уходу сокета прежнего моста
// (keep.ts). Детей не трогает: ребёнок живёт с родителем.
/* eslint-disable @typescript-eslint/no-explicit-any -- ответы SDK без схемы */
import { homeOf, sessionDirectory } from "./host.ts";
import type { Context } from "./plugin.ts";
import type { Say, Slot } from "./tools.ts";

export interface MoveDoors {
  say: Say;
  slots: Map<string, Slot>;
  rootOf(session: string): Promise<string>;
  /** Мост сессии гасится вместе со стоянием её сокета; запись держания корня цела. */
  forget(session: string): void;
  /** Слот корня: новый сам возвращает место (keep.ts). */
  slotFor(session: string, touch: boolean): Promise<Slot>;
}

export function createMoves(ctx: Context) {
  const home = homeOf(ctx);
  const directoryOf = (sessionID: string) => sessionDirectory(ctx, sessionID);
  const exists = (sessionID: string): Promise<boolean> =>
    Promise.resolve()
      .then(() => ctx.session.get({ sessionID } as any))
      .then(
        () => true,
        () => false,
      );
  /** Сессия читается и стоит в локации этого экземпляра: место ей возвращает он. */
  const ours = async (sessionID: string): Promise<boolean> => {
    if (!(await exists(sessionID))) return false;
    const dir = home ? await directoryOf(sessionID) : null;
    return !home || !dir || dir === home.directory;
  };
  /** Сессию перенесли в папку dir. */
  function moved(d: MoveDoors, s: string, dir: string | null): void {
    if (!home || !dir || d.slots.get(s)?.child) return;
    if (dir !== home.directory) {
      if (!d.slots.has(s)) return;
      d.say(
        `Искрон: сессия ${s} перенесена в ${dir} — её место отпускаю экземпляру той папки`,
        "info",
      );
      return d.forget(s);
    }
    void d.rootOf(s).then((root) => (root === s ? d.slotFor(s, false) : null));
  }
  return { home, directoryOf, exists, ours, moved };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
