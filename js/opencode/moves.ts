// Сессия и локация экземпляра плагина (граф nks-dev: #6550, правило 3; #6626).
// OpenCode грузит плагин по разу на локацию, и тулы сессии идут через экземпляр её
// локации. Сессию переносят между папками (событие session.moved, data.location):
// ушла отсюда — прежний экземпляр кладёт маркер с меткой НОВОЙ локации (marker.ts) и
// гасит мост корня, запись держания цела. Экземпляр новой папки часто создаётся самим
// переносом и грузится после события: он берёт маркер при setup; живой — по событию,
// дав прежнему его положить. Место возвращается с терпением к уходу прежнего сокета
// (keep.ts); дети-спутники едут маркером, и их запись в новой папке — отказ (adopt.ts).
/* eslint-disable @typescript-eslint/no-explicit-any -- ответы SDK без схемы */
import { canonDir, sameDir } from "../shared/canon.ts";
import { authDir } from "./bridge-io.ts";
import { homeOf, sessionDirectory } from "./host.ts";
import { writeLostMarker } from "./marker.ts";
import type { Context } from "./plugin.ts";
import type { Home } from "./records.ts";
import type { Say, Slot } from "./tools.ts";
import { createTwins } from "./twins.ts";

/** Сколько живой экземпляр новой папки ждёт маркера переноса от прежнего. */
const ADOPT_MS = Number(process.env.ISKRON_MOVE_ADOPT_MS) || 1_000;

export interface MoveDoors {
  say: Say;
  slots: Map<string, Slot>;
  rootOf(session: string): Promise<string>;
  /** Мост сессии гасится вместе со стоянием её сокета; запись держания корня цела. */
  forget(session: string): void;
  /** Слот корня: новый сам возвращает место (keep.ts). */
  slotFor(session: string, touch: boolean): Promise<Slot>;
  /** Маркер своей локации — взять и вернуть его места (adopt.ts). */
  adopt(): void;
  /** Ребёнок перенесённого корня кончен здесь (leads.ts). */
  away(child: string): Promise<void>;
}

export function createMoves(
  ctx: Context,
  rootOf: (session: string) => Promise<string>,
  live: () => boolean,
) {
  const home = homeOf(ctx);
  // Экземпляр того же каталога другим написанием — корень ведёт один из них (twins.ts).
  const twins = createTwins(
    rootOf,
    live,
    home ? `${canonDir(home.directory)}\0${home.workspace ?? ""}` : null,
  );
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
    return !home || !dir || sameDir(dir, home.directory);
  };
  const left = new Set<string>(); // корни, перенесённые отсюда в другую папку
  /** Сессию перенесли в локацию to. */
  function moved(d: MoveDoors, s: string, to: Home | null): void {
    if (!home || !to?.directory || d.slots.get(s)?.child) return;
    if (!sameDir(to.directory, home.directory)) {
      const root = d.slots.get(s);
      if (!root) return;
      const of = root.place?.name;
      const kids = [...d.slots.values()].filter((k) => k.child && of && k.satelliteOf?.name === of);
      const away = [{ ...root, dir: to.directory }, ...kids].map((x) => ({ ...x, moved: true }));
      writeLostMarker(authDir(), away, to);
      d.say(
        `Искрон: сессия ${s} перенесена в ${to.directory} — её место отпускаю экземпляру той папки`,
        "info",
      );
      // Дети с родителем не переезжают (OpenCode, наблюдено): их поручение кончает перенос —
      // мост гасится здесь, родителю «перенесён» без «КОНЧЕН», а не вторая жизнь без конца.
      left.add(s);
      for (const k of kids) if (k.session) void d.away(k.session);
      twins.release(s);
      return d.forget(s);
    }
    left.delete(s);
    // Переносом сюда корень берёт один экземпляр каталога, не каждое его написание.
    void d.rootOf(s).then((root) => (root === s && twins.claim(s) ? d.slotFor(s, false) : null));
    setTimeout(() => d.adopt(), ADOPT_MS).unref?.();
  }
  /**
   * Слово моста в сессию; «место отняли» — не сессии, перенесённой в другую папку:
   * отнял её же мост нового экземпляра (take из новой папки), слово было бы чужим.
   */
  function relay(on: (s: string | null, p: any, child?: boolean) => void, say: Say) {
    return (s: string | null, params: any, child: boolean): void => {
      if (params?.data?.kind !== "evicted" || !home || !s || child) return on(s, params, child);
      void ours(s).then((mine) =>
        mine
          ? on(s, params, child)
          : say(`Искрон: место сессии ${s} занято из её новой папки — она перенесена`, "info"),
      );
    };
  }
  /**
   * Вызов дочерней сессии, чей корень перенесён отсюда: мост корня здесь не поднимается
   * (вернул бы место перенесённого корня этим экземпляром — #6626), отказ вслух.
   */
  function guard(root: string, session: string): void {
    if (root === session || !left.has(root)) return;
    throw new Error(
      `Отказано (плагин): родитель этой сессии перенесён в другую папку — её поручение кончено переносом, ` +
        "мост родителя здесь не поднимается, а своего места у неё нет; работа этой сессии — дальше без графа, либо слово запустившему.",
    );
  }
  return { home, directoryOf, exists, ours, moved, relay, guard, twins };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
