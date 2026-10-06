// Близнецы каталога (граф nks-dev: #5048, дело №147). OpenCode 2.0.24 держит экземпляр
// плагина на каждое написание каталога (/tmp/A и /private/tmp/A); хуки и тулы сессии идут
// только в экземпляр её написания (наблюдено живьём), и место ведёт он — keepalive продлевает
// его же каталог. Выгрузили его с местом (keepalive выключен или сорвался) — он кладёт маркер,
// а живой экземпляр другого написания того же каталога его будит: ctx.session.move сессии в её
// же каталог — единственный найденный вызов поверхности плагина, поднимающий выгруженное
// написание без хода (get, context, update, switchAgent, wait, interrupt — не поднимают).
// Поднятый экземпляр берёт маркер при старте. Не поднялся — громко в журнал и слово сессии;
// места близнец сам не держит. Реестр — на globalThis: он общий у экземпляров процесса.
/* eslint-disable @typescript-eslint/no-explicit-any -- вызов SDK без типа в @opencode/plugin 2.0.4 */
import { canonDir } from "../shared/canon.ts";
import { authDir } from "./bridge-io.ts";
import { markerWaits } from "./marker.ts";
import type { Context } from "./plugin.ts";
import type { Home, LostEntry } from "./records.ts";

/** Сколько ждать, что поднятый экземпляр возьмёт маркер. */
const WAKE_MS = Number(process.env.ISKRON_WAKE_MS) || 15_000;
/** Пауза до бужения: перезагрузка плагина останавливает близнецов следом — им будить нечего. */
const PAUSE_MS = Math.min(1_000, WAKE_MS / 5);

interface Twin {
  home: Home;
  wake(home: Home, entries: LostEntry[]): void;
}

const registry = (): Set<Twin> => ((globalThis as any).__iskronTwins ??= new Set<Twin>());
const folderOf = (h: Home): string => `${canonDir(h.directory)}\0${h.workspace ?? ""}`;
const sameSpelling = (a: Home, b: Home): boolean =>
  a.directory === b.directory && (a.workspace ?? null) === (b.workspace ?? null);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TwinDoors {
  say(text: string, level: "info" | "warning" | "error"): void;
  /** Громкое слово в сессию (channel.ts, kind=lost). */
  lost(session: string, text: string): void;
}

export function createTwins(ctx: Context, home: Home | null, d: TwinDoors) {
  let gone = false;
  if (!home) return { leave() {}, left(_: LostEntry[]) {} };
  const me: Twin = { home, wake: (h, e) => void wake(h, e) };
  registry().add(me);

  /** Поднять экземпляр написания h, выгруженного с местами entries. */
  async function wake(h: Home, entries: LostEntry[]): Promise<void> {
    const roots = entries.filter((e) => !e.child && !e.moved && e.session);
    await sleep(PAUSE_MS);
    if (gone || !roots.length) return;
    let why = "";
    for (const e of roots) {
      try {
        // В её же каталог: OpenCode поднимает каталог назначения, ход модели не начинается.
        const args = { sessionID: e.session, directory: h.directory, delivery: "queue" };
        await (ctx.session as any).move(args);
        why = "";
        break;
      } catch (err) {
        why = (err as Error).message;
      }
    }
    if (!why) {
      await sleep(WAKE_MS);
      if (!markerWaits(authDir(), h)) {
        d.say(`Искрон: экземпляр каталога ${h.directory} поднят заново — место вернул он`, "info");
        return;
      }
      why = `за ${Math.round(WAKE_MS / 1000)} с маркер его мест никто не взял`;
    }
    if (gone) return;
    const named = roots.map((e) => e.key ?? e.session).join(", ");
    d.say(
      `Искрон: каталог ${h.directory} выгружен с местом (${named}) и не поднят — ${why}`,
      "error",
    );
    for (const e of roots)
      d.lost(
        e.session as string,
        `Искрон: место ${e.key ?? "этой сессии"} отпущено — экземпляр плагина каталога ${h.directory} ` +
          `выгружен и не поднялся (${why}). Верни место: iskron_stand.`,
      );
  }

  return {
    /** Экземпляр останавливается — из реестра, будить его некому и незачем. */
    leave(): void {
      gone = true;
      registry().delete(me);
    },
    /** Остановка с местами entries (маркер лёг): живой близнец будит это написание. */
    left(entries: LostEntry[]): void {
      if (!entries.length) return;
      const live = [...registry()];
      // То же написание живо (перезагрузка плагина) — маркер его, будить нечего.
      if (live.some((t) => sameSpelling(t.home, home))) return;
      live.find((t) => folderOf(t.home) === folderOf(home))?.wake(home, entries);
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
