// Слух сессии OpenCode переживает простой, перезапуск плагина и вытеснение
// каталога (граф nks-dev: #5140). Три хода половины «тулы», собранные здесь:
//   • возврат места — мост нового экземпляра плагина сам находит СВОЮ запись
//     держания (`iskron/resume {key?, cwd, session}`: ключ, если плагин его знает —
//     из `held` прежнего моста или из маркера потери этой сессии, иначе каталог
//     сессии, и тогда только запись, на которой стояла она же, #6017) и шлёт
//     hello.pending, а накопленное приходит пачкой побудки;
//   • маркер потери (marker.ts) — плагин, который останавливают с держащими
//     мостами, пишет на диск, кого держал (файл на экземпляр с меткой локации);
//     следующий экземпляр той же локации говорит это в сессию, державшую место, и тут же
//     возвращает место без её хода — стоящая сессия, ждущая кадров, тулов не
//     зовёт (#6137); не вернулось — слово туда же, и сессия под сторожем;
//   • сторож слуха — раз в N минут стоявшие сессии спрашивают мост
//     (`iskron/check {key?, cwd}`): мёртвый мост поднимается заново и возвращает
//     место, глухой переоткрывает сокет; мост, места не ведущий, из-под сторожа
//     выходит — его простой снова считает жнец.
import { envName } from "../delivery/index.ts";
import type { Bridge } from "../shared/bridge-client.ts";
import { sleep } from "./bridge-io.ts";
import type { LostEntry } from "./records.ts";
import type { Say } from "./tools.ts";

/** Такт сторожа слуха; переменная — шов для проб, не ручка человека. Инвариант: короче простоя жнеца (tools.ts). */
export const WATCH_MS = Number(process.env[envName("BRIDGE_WATCH_MS")] || 5 * 60_000);
/** Сколько возврат ждёт ухода сокета прежнего моста (bye тонкого моста — до 5 с); переменная — для проб. */
const PATIENCE_MS = Number(process.env[envName("RESUME_PATIENCE_MS")] || 10_000);
const STEP_MS = 500;

/** Исход возврата: место взято; его сокет держит живой чужой мост; не вернулось иначе. */
export type Resumed = "held" | "elsewhere" | "none";

export interface KeptSlot {
  bridge: Bridge;
  session: string | null;
  /** Мост держит стояние — такой не отпускают по простою. */
  holding: boolean;
  /** Сессия стояла хоть раз — за ней смотрит сторож слуха. */
  stood: boolean;
  /** Каталог сессии — ключ возврата места, когда ключ стояния неизвестен. */
  dir: string | null;
  /** Ключ стояния, которое держал мост (из `held` или возврата) — точный адрес записи. */
  key: string | null;
  /** Возврат места в полёте: вызов тула ждёт его, чтобы не занимать место дважды. */
  resume: Promise<unknown> | null;
  /** Мост дочерней сессии (её собственное стояние, #5154): в подсказки возврата корня его запись не идёт. */
  child?: boolean;
  /** Место корня, спутником которого встал ребёнок, — его мост нового экземпляра встаёт тем же спутником (#6625). */
  satelliteOf?: { realm: string; karta: string; name: string } | null;
  /** Дело поручения ребёнка — исход ведущего субагента (leads.ts) переживает перезагрузку. */
  room?: string | null;
  /** Первый ход ребёнка родителю уже назван — новый экземпляр слова о ходе не повторяет. */
  noted?: boolean;
  /** Последний текст ребёнка — итог «КОНЧЕН» переживает перезагрузку. */
  last?: string;
}

/**
 * Слово агенту о месте, которое мост вернул сам: какое имя занято. Промпт входит следующим шагом хода, а первый вызов сессии
 * ждёт возврата и уходит раньше слова: запись, сделанную им, слово не упреждает —
 * оно зовёт проверить её автора.
 */
export function resumedWord(key: string): string {
  // Чужие места того же каталога не называются: возврат берёт запись, на которой стояла
  // эта сессия (мост сверяет сессию), и чужой ключ в её слове звал бы её к чужому.
  return (
    `Искрон: мост поднялся и сам вернул место ${key} — по своей записи держания (каталог сессии либо ключ прежнего места), без твоего хода. ` +
    'Сверь имя с выведенным для этой сессии: чужое — отпусти его iskron_channel(action="leave") (канал цел; revoke места, основавшего канал, платформа отвергает) и займи своё одним iskron_stand; ' +
    "запись, уже ушедшую этим ходом, проверь по автору в истории узла — слово под чужим именем ляжет другому месту, а мост ответит успехом."
  );
}

/** Слово сессии, чьё место держит не её мост: возврат не удался, и чем вернуть. */
const elsewhereWord = (keys: string[]): string =>
  `Искрон: возврат места ${keys.join(", ")} с диска не удался — его сокет держит другой живой мост, не мост этой сессии: ` +
  "слух и занятость здесь места не держат. Позови iskron_stand с этим именем, take не нужен: место прежнего моста этой же сессии " +
  "мост вернёт сам, место другой сессии не тронет и встанет рядом на имя.N со слухом.";

export interface KeeperDoors<S extends KeptSlot> {
  say: Say;
  /** Слово в сессию — ходом агента, не строкой лога (возврат места без его хода, #5366); child — адресат только своя дочерняя сессия. */
  tell: (root: string, text: string, child?: boolean) => void;
  /** Слово о потере слуха в сессию — громко (#5140). */
  lost: (root: string, text: string) => void;
  /** Слот корневой сессии: живой или поднятый заново; touch=false — простой не освежать (сторож — не вызов). */
  slotFor: (root: string, touch: boolean) => Promise<S>;
  ready: (slot: S) => Promise<void>;
  directoryOf: (root: string) => Promise<string | null>;
  /** Сессия ещё есть и её тулы идут через этот экземпляр: её место стоит возвращать здесь, и слово до неё дойдёт. */
  exists: (root: string) => Promise<boolean>;
}

export interface Keeper<S extends KeptSlot> {
  /**
   * Записи маркера потери — по сессии, их державшей: возврат по ключу точнее, чем
   * по каталогу, а исход первого возврата такой сессии — слово в неё.
   */
  hint(entries: LostEntry[]): void;
  /**
   * Места из маркера потери — обратно сразу, без хода агента: стоящая сессия,
   * ждущая кадров, тулов не зовёт, и возврат, ждавший её вызова, не приходил
   * никогда (#6137). Слово о потере — в державшую сессию, исход возврата — туда
   * же. Детские места возвращаются своим мостом по ключу, когда ребёнок встанет;
   * сессия, которой больше нет, моста не получает. Слово каждой — только о её местах;
   * сессии, не державшей места, слова о чужих нет.
   */
  resumeLost(entries: LostEntry[], wordFor: (session: string) => string | null): Promise<void>;
  /** Новая сессия получила мост: вернуть её место с диска, если прежний экземпляр его держал; patience — сколько ждать ухода сокета чужого моста. */
  resume(slot: S, root: string, quiet?: boolean, patience?: number): Promise<Resumed>;
  /** Успешный stand/connect/register — сессия стоит: держащий мост не жнётся, сторож смотрит. */
  stood(slot: S): void;
  /** Сессия удалена — сторожу за ней не смотреть: иначе он поднимал бы ей мост каждый такт. */
  forget(root: string): void;
  stop(): void;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- ответы моста приходят без схемы */

export function createKeeper<S extends KeptSlot>(doors: KeeperDoors<S>): Keeper<S> {
  const roots = new Set<string>(); // стоявшие корневые сессии
  // Сессия → ключ из маркера потери. Ключуется сессией, не каталогом: ключ
  // подсказывается только той сессии, что держала его сокет, — другая сессия
  // того же каталога чужого места не наследует (#6017).
  const hints = new Map<string, string>();
  // Сессия → её запись маркера потери, пока её первый возврат не прошёл: исход
  // этого возврата — слово в неё, какой бы он ни был (#6137).
  const marked = new Map<string, LostEntry>();
  // Сессия → место из маркера, чей возврат не удался и ждёт повтора сторожа: исход
  // повтора — тоже слово в неё, иначе после второй неудачи она не слышит ничего.
  const retrying = new Map<string, string>();
  let stopped = false;

  /** Место из маркера не вернулось: слово в ту сессию, и сессия — под сторож, он повторит. */
  function notBack(root: string, mark: LostEntry, why: string): void {
    const place = mark.key ?? mark.dir ?? root;
    roots.add(root);
    retrying.set(root, place);
    doors.tell(
      root,
      `Искрон: место ${place} с диска не вернулось: ${why}. ` +
        "Сторож слуха повторит возврат один раз; не ждёшь — iskron_stand.",
    );
  }

  function selector(slot: S): { key?: string; cwd?: string; session?: string } {
    const session = slot.session ? { session: slot.session } : {};
    // Детский мост возвращает место только по ключу: по каталогу он поднял бы
    // запись корня, стоящего в том же каталоге.
    if (slot.child) return slot.key ? { key: slot.key, ...session } : session;
    const key = slot.key ?? (slot.session ? hints.get(slot.session) : undefined);
    // Сессия — своя запись по каталогу только та, на которой стояла она (мост сверяет).
    return { ...(key ? { key } : {}), ...(slot.dir ? { cwd: slot.dir } : {}), ...session };
  }

  /**
   * Возврат с терпением: сокет места держит живой мост — прежний, ещё не ушедший
   * (перезагрузка, перенос сессии в другую папку), — и возврат повторяется до ухода
   * его сокета или до срока, а слово об исходе говорится только по последней попытке.
   */
  async function resume(
    slot: S,
    root: string,
    quiet = false,
    patience = PATIENCE_MS,
  ): Promise<Resumed> {
    const until = Date.now() + patience;
    for (;;) {
      const final = Date.now() + STEP_MS > until;
      const r = await once(slot, root, quiet, final);
      if (r !== "elsewhere" || final || stopped) return r;
      await sleep(STEP_MS);
    }
  }

  async function once(slot: S, root: string, quiet: boolean, final: boolean): Promise<Resumed> {
    const mark = slot.child ? undefined : marked.get(root);
    try {
      await doors.ready(slot);
      slot.dir ??= mark?.dir ?? (await doors.directoryOf(root));
      if (stopped) return "none";
      if ((!slot.dir && !slot.key) || (slot.child && !slot.key)) {
        marked.delete(root);
        if (mark) notBack(root, mark, "ни ключа места, ни каталога сессии");
        return "none";
      }
      const r: any = await slot.bridge.request("iskron/resume", selector(slot), {
        timeoutMs: 30_000,
      });
      const elsewhere = Array.isArray(r?.elsewhere) && r.elsewhere.length ? r.elsewhere : null;
      if (!r?.resumed && elsewhere && !final) return "elsewhere"; // ждём ухода его сокета молча
      marked.delete(root);
      if (!r?.resumed) {
        if (mark) notBack(root, mark, typeof r?.word === "string" ? r.word : "мост не ответил");
        // Своё место сессии держит живой мост другой сессии: вернул не этот мост,
        // и без слова занятость пошла бы мостом, места не держащим (#6626). Ребёнку
        // на паузе — молча: его исход решает возврат (children.ts), не он сам.
        else if (elsewhere) {
          if (!quiet) doors.tell(root, elsewhereWord(elsewhere), slot.child);
        }
        // Место прежней сборки без сессии по каталогу не возвращается, но и не
        // молчит: мост называет его, и слово идёт в сессию — вернуть по имени (#6017).
        else if (Array.isArray(r?.legacy) && r.legacy.length && typeof r.word === "string")
          doors.tell(root, `Искрон: ${r.word}.`, slot.child);
        return elsewhere ? "elsewhere" : "none";
      }
      slot.holding = true;
      slot.stood = true;
      if (typeof r.key === "string") slot.key = r.key;
      roots.add(root);
      doors.say(`Искрон: сессия ${root} — ${r.word}`, "info");
      // Место занято без хода агента, и имя взято из записи каталога: каталог не
      // различает стояний одной роли в одной рабочей копии, а слово под чужим
      // именем ляжет брату при успешном ответе (#5366). Занятое имя — в сессию;
      // ребёнку, чьё место вернулось по его же ключу после перезагрузки, — молча: он ждёт (#6625).
      if (typeof r.key === "string" && !quiet) doors.tell(root, resumedWord(r.key), slot.child);
      return "held";
    } catch (e) {
      marked.delete(root);
      doors.say(
        `Искрон: возврат места сессии ${root} не удался — ${(e as Error).message}`,
        "warning",
      );
      if (mark && !stopped) notBack(root, mark, (e as Error).message);
      return "none";
    }
  }

  async function check(root: string): Promise<void> {
    const slot = await doors.slotFor(root, false); // мёртвый мост здесь заменён живым; простой не освежается
    if (slot.resume) await slot.resume;
    if (!slot.dir) slot.dir = await doors.directoryOf(root);
    await doors.ready(slot);
    const r: any = await slot.bridge.request("iskron/check", selector(slot), {
      timeoutMs: 30_000,
    });
    if (typeof r?.key === "string") slot.key = r.key;
    if (r?.holding) slot.holding = true;
    else if (r?.holding === false) {
      // Места мост не ведёт и вернуть нечего (holding=false приходит только без
      // возврата): сторожу здесь делать нечего, жнец снова считает простой; новое
      // стояние вернёт сессию под сторож через stood.
      slot.holding = false;
      roots.delete(root);
      const place = retrying.get(root);
      if (place && !r?.resumed)
        doors.tell(
          root,
          `Искрон: место ${place} не вернулось и на повторе сторожа: ${r?.word ?? "мост не сказал почему"}. ` +
            "Сам сторож его больше не поднимает — займи место iskron_stand.",
          slot.child,
        );
    }
    retrying.delete(root);
    if (r?.resumed) {
      doors.say(`Искрон: сторож слуха вернул место сессии ${root} — ${r.word}`, "info");
      // Тот же возврат без хода агента, тем же выбором свежайшей записи (#5366).
      if (typeof r.key === "string") doors.tell(root, resumedWord(r.key), slot.child);
    } else if (r?.reopened)
      doors.say(`Искрон: сторож слуха переоткрыл сокет сессии ${root} — ${r.word}`, "warning");
    else if (r?.stuck) doors.say(r.word, "error"); // слово в сессию мост шлёт сам (kind=lost), один раз
  }

  const timer = setInterval(() => {
    if (stopped) return;
    for (const root of roots)
      void check(root).catch((e: Error) =>
        doors.say(`Искрон: сторож слуха сессии ${root} — ${e.message}`, "warning"),
      );
  }, WATCH_MS);
  timer.unref?.();

  return {
    hint(entries) {
      // Детская запись корню не подсказка — ребёнок возвращается своим мостом по ключу.
      for (const e of entries) {
        if (!e.session || e.child) continue;
        if (e.key) hints.set(e.session, e.key);
        marked.set(e.session, e);
      }
    },
    async resumeLost(entries, wordFor) {
      const seen = new Set<string>();
      for (const e of entries) {
        if (stopped) break;
        if (e.child || !e.session || seen.has(e.session)) continue;
        seen.add(e.session);
        if (!(await doors.exists(e.session))) continue;
        const word = wordFor(e.session); // только её места
        if (word) doors.lost(e.session, word);
        await doors.slotFor(e.session, false); // новый слот сам зовёт resume; живой — уже вернул
      }
    },
    resume,
    stood(slot) {
      slot.holding = true;
      slot.stood = true;
      if (slot.session) roots.add(slot.session);
    },
    forget(root) {
      roots.delete(root);
      retrying.delete(root);
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
