// Слух сессии OpenCode переживает простой, перезапуск плагина и вытеснение
// каталога (граф nks-dev: #5140). Три хода половины «тулы», собранные здесь:
//   • возврат места — мост нового экземпляра плагина сам находит СВОЮ запись
//     держания (`iskron/resume {key?, cwd, session}`: ключ, если плагин его знает —
//     из `held` прежнего моста или из маркера потери этой сессии, иначе каталог
//     сессии, и тогда только запись, на которой стояла она же, #6017) и шлёт
//     hello.pending, а накопленное приходит пачкой побудки;
//   • маркер потери — плагин, который останавливают с держащими мостами, пишет
//     на диск, кого держал (файл на экземпляр: локаций сервиса несколько);
//     следующий экземпляр говорит это в сессию, державшую место, и тут же
//     возвращает место без её хода — стоящая сессия, ждущая кадров, тулов не
//     зовёт (#6137); не вернулось — слово туда же, и сессия под сторожем;
//   • сторож слуха — раз в N минут стоявшие сессии спрашивают мост
//     (`iskron/check {key?, cwd}`): мёртвый мост поднимается заново и возвращает
//     место, глухой переоткрывает сокет; мост, места не ведущий, из-под сторожа
//     выходит — его простой снова считает жнец.
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Bridge } from "../shared/bridge-client.ts";
import type { Say } from "./tools.ts";

/** Такт сторожа слуха; переменная — шов для проб, не ручка человека. Инвариант: короче простоя жнеца (tools.ts). */
export const WATCH_MS = Number(process.env.ISKRON_BRIDGE_WATCH_MS || 5 * 60_000);

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
  resume: Promise<void> | null;
  /** Мост дочерней сессии (её собственное стояние, #5154): в подсказки возврата корня его запись не идёт. */
  child?: boolean;
  /** Место корня, спутником которого встал ребёнок, — его мост нового экземпляра встаёт тем же спутником (#6625). */
  satelliteOf?: { realm: string; karta: string; name: string } | null;
  /** Дело поручения ребёнка — исход ведущего субагента (leads.ts) переживает перезагрузку. */
  room?: string | null;
  /** Первый ход ребёнка родителю уже назван — новый экземпляр слова о ходе не повторяет. */
  noted?: boolean;
}

export interface LostEntry {
  session: string;
  dir: string | null;
  key: string | null;
  child?: boolean;
  of?: { realm: string; karta: string; name: string } | null;
  room?: string | null;
  noted?: boolean;
}

/** Поля детской записи маркера: место корня, дело поручения, сказанный ход. */
const childPart = (e: { of?: LostEntry["of"]; room?: string | null; noted?: boolean }) => ({
  of: e.of ?? null,
  room: e.room ?? null,
  ...(e.noted ? { noted: true } : {}),
});
interface Lost {
  at: string;
  entries: LostEntry[];
}

const MARKER_PREFIX = "opencode-lost";

/** Остановка плагина с держащими мостами — на диск, кого держал: следующий экземпляр скажет. */
export function writeLostMarker(authDir: string, slots: Iterable<KeptSlot>): void {
  const entries = [...slots]
    .filter((s) => s.holding && s.session)
    .map((s) => ({
      session: s.session as string,
      dir: s.dir,
      key: s.key,
      child: !!s.child,
      ...(s.child ? childPart({ of: s.satelliteOf, room: s.room, noted: s.noted }) : {}),
    }));
  if (!entries.length) return;
  try {
    mkdirSync(authDir, { recursive: true, mode: 0o700 });
    const lost: Lost = { at: new Date().toISOString(), entries };
    // Свой файл на экземпляр: два плагина одного сервиса не затирают друг друга.
    const name = `${MARKER_PREFIX}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.json`;
    writeFileSync(join(authDir, name), JSON.stringify(lost), { mode: 0o600 });
  } catch {
    /* маркер — слово, не обязательство */
  }
}

/** Маркеры прежних экземпляров, прочитанные и стёртые: слово о потере слуха и ключи мест. */
export function takeLostMarker(
  authDir: string,
): { text: string | null; entries: LostEntry[] } | null {
  const entries: LostEntry[] = [];
  let at = "";
  let files: string[];
  try {
    files = readdirSync(authDir).filter((f) => f.startsWith(MARKER_PREFIX) && f.endsWith(".json"));
  } catch {
    return null;
  }
  for (const f of files) {
    // Сперва снять, потом разбирать: битый маркер иначе лежал бы вечно.
    let text: string;
    try {
      text = readFileSync(join(authDir, f), "utf8");
      unlinkSync(join(authDir, f));
    } catch {
      continue;
    }
    try {
      const lost = JSON.parse(text) as Lost;
      if (lost?.at > at) at = lost.at;
      for (const e of lost?.entries ?? [])
        entries.push({
          session: e.session,
          dir: e.dir ?? null,
          key: e.key ?? null,
          child: !!e.child,
          ...(e.child ? childPart(e) : {}),
        });
    } catch {
      /* битый маркер — не слово */
    }
  }
  if (!entries.length) return null;
  const when = new Date(at);
  const hhmm = Number.isNaN(when.getTime())
    ? at
    : `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  // Слово — корням: места детей возвращаются тихо своими мостами (children.ts), их ключи
  // в слове корня звали бы его возвращать чужое; без мест корней слова нет.
  const where = entries
    .filter((e) => !e.child)
    .map((e) => e.key ?? e.dir ?? e.session)
    .join(", ");
  return {
    text: where
      ? `Искрон: слух был потерян в ${hhmm} — плагин остановили (перезапуск, вытеснение каталога) с держащим мостом: ${where}. ` +
        "Место возвращается с диска само; ожидавшие кадры придут пачкой. Не вернулось — iskron_stand."
      : null,
    entries,
  };
}

/**
 * Слово агенту о месте, которое мост вернул сам: какое имя занято и с кем оно
 * делит каталог. Промпт входит следующим шагом хода, а первый вызов сессии
 * ждёт возврата и уходит раньше слова: запись, сделанную им, слово не упреждает —
 * оно зовёт проверить её автора.
 */
export function resumedWord(key: string, others?: unknown): string {
  const rest = Array.isArray(others) ? others.filter((k) => typeof k === "string") : [];
  return (
    `Искрон: мост поднялся и сам вернул место ${key} — по своей записи держания (каталог сессии либо ключ прежнего места), без твоего хода. ` +
    (rest.length
      ? `В том же каталоге записи и других мест: ${rest.join(", ")} — каталог их не различает; возврат взял место, на котором стояла эта сессия. `
      : "") +
    'Сверь имя с выведенным для этой сессии: чужое — отпусти его iskron_channel(action="leave") (канал цел; revoke места, основавшего канал, платформа отвергает) и займи своё одним iskron_stand; ' +
    "запись, уже ушедшую этим ходом, проверь по автору в истории узла — слово под чужим именем ляжет другому месту, а мост ответит успехом."
  );
}

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
  /** Сессия ещё есть: её место стоит возвращать, и слово до неё дойдёт. */
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
   * сессия, которой больше нет, моста не получает. true — слово сказано хоть одной.
   */
  resumeLost(entries: LostEntry[], word: string | null): Promise<boolean>;
  /** Новая сессия получила мост: вернуть её место с диска, если прежний экземпляр его держал. */
  resume(slot: S, root: string, quiet?: boolean): Promise<void>;
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

  async function resume(slot: S, root: string, quiet = false): Promise<void> {
    const mark = slot.child ? undefined : marked.get(root);
    marked.delete(root);
    try {
      await doors.ready(slot);
      slot.dir ??= mark?.dir ?? (await doors.directoryOf(root));
      if (stopped) return;
      if ((!slot.dir && !slot.key) || (slot.child && !slot.key)) {
        if (mark) notBack(root, mark, "ни ключа места, ни каталога сессии");
        return;
      }
      const r: any = await slot.bridge.request("iskron/resume", selector(slot), {
        timeoutMs: 30_000,
      });
      if (!r?.resumed) {
        if (mark) notBack(root, mark, typeof r?.word === "string" ? r.word : "мост не ответил");
        // Место прежней сборки без сессии по каталогу не возвращается, но и не
        // молчит: мост называет его, и слово идёт в сессию — вернуть по имени (#6017).
        else if (Array.isArray(r?.legacy) && r.legacy.length && typeof r.word === "string")
          doors.tell(root, `Искрон: ${r.word}.`, slot.child);
        return;
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
      if (typeof r.key === "string" && !quiet)
        doors.tell(root, resumedWord(r.key, r.others), slot.child);
    } catch (e) {
      doors.say(
        `Искрон: возврат места сессии ${root} не удался — ${(e as Error).message}`,
        "warning",
      );
      if (mark && !stopped) notBack(root, mark, (e as Error).message);
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
      if (typeof r.key === "string") doors.tell(root, resumedWord(r.key, r.others), slot.child);
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
    async resumeLost(entries, word) {
      const seen = new Set<string>();
      let said = false;
      for (const e of entries) {
        if (stopped) break;
        if (e.child || !e.session || seen.has(e.session)) continue;
        seen.add(e.session);
        if (!(await doors.exists(e.session))) continue;
        if (word) doors.lost(e.session, word);
        said = true;
        await doors.slotFor(e.session, false); // новый слот сам зовёт resume; живой — уже вернул
      }
      return said;
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
