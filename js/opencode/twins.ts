// Близнецы каталога (граф nks-dev: #5048, дело №147). OpenCode 2.0.24 держит экземпляр
// плагина на каждое написание каталога (/tmp/A и /private/tmp/A); хуки и тулы сессии идут
// только в экземпляр её написания (наблюдено живьём), и место ведёт он — keepalive продлевает
// его же каталог. Выгрузили его с местом (keepalive выключен или сорвался) — он кладёт маркер,
// а живой экземпляр другого написания того же каталога его будит: ctx.session.move сессии в её
// же каталог — единственный найденный вызов поверхности плагина, поднимающий выгруженное
// написание (get, context, update, switchAgent, wait, interrupt — не поднимают).
// ЦЕНА (наблюдено живьём на 2.0.24): ход модели перенос не начинает, но в историю сессии
// ложится location-switched, и следующий ход несёт модели строку «The working directory has
// been changed to <тот же каталог>». Поэтому будим, только если написание не поднялось само
// и маркер ещё лежит. Поднятый экземпляр берёт маркер при старте. Не поднялся — громко в
// журнал и слово сессии; места близнец сам не держит. Реестр — на globalThis: он общий у
// экземпляров процесса; по нему же ребёнок, перенесённый в другой каталог, находит корень
// родителя (moves.ts, #6695).
/* eslint-disable @typescript-eslint/no-explicit-any -- вызов SDK без типа в @opencode/plugin 2.0.4 */
import { canonDir } from "../shared/canon.ts";
import { authDir } from "./bridge-io.ts";
import { markerWaits } from "./marker.ts";
import type { Context } from "./plugin.ts";
import type { Home, LostEntry } from "./records.ts";
import type { Slot } from "./slot.ts";

/** Сколько ждать, что поднятый экземпляр возьмёт маркер. */
const WAKE_MS = Number(process.env.ISKRON_WAKE_MS) || 15_000;
/** Пауза до бужения: перезагрузка плагина останавливает близнецов следом — им будить нечего. */
const PAUSE_MS = Math.min(1_000, WAKE_MS / 5);

interface Twin {
  home: Home | null;
  wake(home: Home, entries: LostEntry[]): void;
  /** Слот корня, держащий место в этом экземпляре; нет — null. */
  holds(root: string): Slot | null;
}

const registry = (): Set<Twin> => ((globalThis as any).__iskronTwins ??= new Set<Twin>());

/** Слот, держащий место корня в каком-либо экземпляре этого процесса (moves.ts, #6695). */
export function heldInProcess(root: string): Slot | null {
  for (const t of registry()) {
    const s = t.holds(root);
    if (s) return s;
  }
  return null;
}

const folderOf = (h: Home): string => `${canonDir(h.directory)}\0${h.workspace ?? ""}`;
const sameSpelling = (a: Home, b: Home): boolean =>
  a.directory === b.directory && (a.workspace ?? null) === (b.workspace ?? null);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TwinDoors {
  say(text: string, level: "info" | "warning" | "error"): void;
  /** Громкое слово в сессию (channel.ts, kind=lost). */
  lost(session: string, text: string): void;
  /** Слот корня, держащий место в этом экземпляре (tools.ts). */
  holds(root: string): Slot | null;
}

export function createTwins(ctx: Context, home: Home | null, d: TwinDoors) {
  let gone = false;
  const me: Twin = { home, wake: (h, e) => void wake(h, e), holds: (r) => d.holds(r) };
  registry().add(me);

  /** Поднять экземпляр написания h, выгруженного с местами entries. */
  async function wake(h: Home, entries: LostEntry[]): Promise<void> {
    const roots = entries.filter((e) => !e.child && !e.moved && e.session);
    await sleep(PAUSE_MS);
    if (gone || !roots.length) return;
    // Написание уже поднялось само (запрос человека, перезагрузка) или маркер уже взят — не будить.
    const up = [...registry()].some((t) => t.home && sameSpelling(t.home, h));
    if (up || !markerWaits(authDir(), h)) return;
    let why = "";
    for (const e of roots) {
      try {
        // В её же каталог: OpenCode поднимает каталог назначения; хода нет, в истории — location-switched.
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
      if (!home || !entries.length) return;
      const live = [...registry()].filter((t) => t.home);
      // То же написание живо (перезагрузка плагина) — маркер его, будить нечего.
      if (live.some((t) => sameSpelling(t.home as Home, home))) return;
      live.find((t) => folderOf(t.home as Home) === folderOf(home))?.wake(home, entries);
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
