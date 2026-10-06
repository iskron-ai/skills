// Сессия и локация экземпляра плагина (граф nks-dev: #6550, правило 3; #6626).
// OpenCode грузит плагин по разу на локацию, и тулы сессии идут через экземпляр её
// локации. Сессию переносят между папками (событие session.moved, data.location):
// ушла отсюда — прежний экземпляр кладёт маркер с меткой НОВОЙ локации (marker.ts) и
// гасит мост корня, запись держания цела. Экземпляр новой папки часто создаётся самим
// переносом и грузится после события: он берёт маркер при setup; живой — по событию,
// дав прежнему его положить. Место возвращается с терпением к уходу прежнего сокета
// (keep.ts); дети-спутники едут маркером, и их запись в новой папке — отказ (adopt.ts).
// Ребёнка переносят и одного, без родителя (#6695): вставший спутником едет им же
// (children.ts, handoff); не вставший — экземпляр его новой папки находит корень в
// экземпляре папки родителя (farRoot) и ставит спутника его места.
/* eslint-disable @typescript-eslint/no-explicit-any -- ответы SDK без схемы */
import { authDir } from "./bridge-io.ts";
import { homeOf, sessionDirectory } from "./host.ts";
import { writeLostMarker } from "./marker.ts";
import type { Context } from "./plugin.ts";
import type { Home } from "./records.ts";
import type { Slot } from "./slot.ts";
import type { Say } from "./tools.ts";
import { heldInProcess } from "./twins.ts";

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
  const left = new Set<string>(); // корни, перенесённые отсюда в другую папку
  /** Сессию перенесли в локацию to. */
  function moved(d: MoveDoors, s: string, to: Home | null): void {
    if (!home || !to?.directory || d.slots.get(s)?.child) return;
    // Написание — как пришло: перенос /tmp/A ↔ /private/tmp/A — перенос между экземплярами (#5048).
    if (to.directory !== home.directory) {
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
      return d.forget(s);
    }
    left.delete(s);
    void d.rootOf(s).then((root) => (root === s ? d.slotFor(s, false) : null));
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
  /**
   * Корень дочерней сессии, которую перенесли одну в этот каталог (#6695): место родителя
   * держит экземпляр его каталога, и в этом процессе он находится общим реестром (twins.ts) —
   * ребёнок встаёт спутником его места, как до переноса. Не нашёлся, а корень в другом
   * каталоге — "foreign": мост корня здесь его места не возвращает (#6626), встать — отказ.
   */
  async function farRoot(root: string): Promise<Slot | "foreign" | null> {
    const held = heldInProcess(root);
    if (held) return held;
    const dir = home ? await directoryOf(root) : null;
    return home && dir && dir !== home.directory ? "foreign" : null;
  }
  /** Отказ встать спутником корня из другого каталога, которого процесс не держит, — на этот миг. */
  const farRefusal = async (root: string | null): Promise<string | null> =>
    root && (await farRoot(root)) === "foreign"
      ? "Отказано (плагин): эта дочерняя сессия перенесена в другой каталог, чем её родитель, а место родителя " +
        "не держит ни один экземпляр плагина этого процесса OpenCode — родитель в другом процессе либо места не держит. " +
        "Спутником отсюда не встать; читать можно и так, писать — словом запустившему."
      : null;
  return { home, directoryOf, exists, ours, moved, relay, guard, farRoot, farRefusal };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
