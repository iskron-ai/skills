// Половина «канал» — кадры стояния внутри сессии OpenCode (граф nks-dev: #4266).
//
// Сокет стояния держит мост сессии (дочерний процесс плагина, свой у каждой
// корневой сессии): переоткрывает, различает мёртвый токен, публикует
// занятость. Плагину остаётся то, чего у моста нет, — вложить кадр в сессию
// агента промптом (ctx.session.prompt). У промпта OpenCode 2 два способа
// вложения (поверхность харнеса: «Enter steers the active session, Alt+Enter
// queues the prompt for later»): steer входит в идущий ход следующим шагом,
// queue ждёт конца хода — и очередь харнес отдаёт по одному промпту на ход.
// Живой кадр и громкое слово о слухе идут steer: с queue у делателя с длинными
// ходами кадры всплывали по одному за ход и отставали часами (граф nks-dev:
// #5233). Пачка побудки и лежалых — queue: она не срочна и ход не режет.
// Кадры дела «в пачку» — тоже queue, одним промптом на пачку, как у сторожа:
// шапка счётом по делам с указателем, строки ниже — только адресованные месту
// (#6574); неадресованное дело идёт в пачку и со стопкой прерывания — текстом
// в ход входит только адресованное. Пока прежний промпт пачки не взят ходом,
// новые кадры копятся здесь (дописать неотданный промпт контекст плагина не
// даёт) и уходят одним, когда OpenCode скажет, что взял. Пачка из одних счётов
// хода не будит: ждёт и едет шапкой с ближайшим промптом в сессию — пачки,
// кадра или человека (хук prompt). Прямое слово и слово человека в пачку не
// ложатся — steer, целиком.
// Доставка есть возврат управления агенту; кадр, ушедший в лог, — глушитель
// (урок контура opencode-плагина канала: делатель стоит глухим, считая себя
// слушающим).
//
// Адресат — сессия, чей мост принёс кадр: адрес приходит вместе с событием,
// угадывать нечего. Кадр от моста, ещё никому не отданного, идёт в свежайшую
// корневую сессию, которую плагин видел (списка сессий у контекста OpenCode 2
// нет); дочерняя сессия (субагент) — адресат только своего моста, поднятого её
// собственным стоянием (#5154), угадыванием она не выбирается.
import { type ChannelEvent } from "../bridge/hold.ts";
import { addressedToMine } from "../shared/addressed.ts";
import { askFromPerson } from "../shared/asks.ts";
import { classifyOrigin, type Frame, isDirectWord } from "../shared/channel.ts";
import { batchHead, batchLines, frameToText } from "../shared/frame-text.ts";
import { roomKind, stackOf } from "../shared/room-kinds.ts";
import { deliveryKeys, eventIn } from "../shared/seen.ts";
import type { Context } from "./plugin.ts";
import { type Say } from "./tools.ts";

export interface Channel {
  /**
   * Дверь половины «тулы»: событие моста сессии `session` (null — мост ещё
   * ничей); `child` — мост дочерней сессии, вставшей своим вызовом.
   */
  onEvent(session: string | null, params: unknown, child?: boolean): void;
  /** OpenCode взял промпт из очереди сессии (`inbox` — его id) или сессия встала (без id). */
  taken(session: string, inbox?: string): void;
  /** Плагин останавливают: накопленное уходит сейчас, не умирает с ним. */
  stop(): void;
  /** Счёт записей, ждущих попутного промпта в корневую сессию `session`; null — их нет. */
  ride(session: string): string | null;
}

/** Окно пачки дела; переменная — шов для проб, не ручка человека. */
const CASE_BATCH_MS = Number(process.env.ISKRON_OPENCODE_BATCH_MS) || 5_000;
/** Полная пачка уходит, не дожидаясь окна. */
const CASE_BATCH_CAP = 20;
/** Промпт пачки, о взятии которого OpenCode молчит дольше, считается взятым: кадры не ждут вечно. */
const PENDING_MAX_MS = Number(process.env.ISKRON_OPENCODE_PENDING_MS) || 120_000;
/**
 * Слово платформы, о взятии чьего промпта OpenCode молчит, держит свой повтор не
 * дольше этого: предел длиннее часа такта внимания, иначе повтор следующего часа
 * прошёл бы — ровно тот случай (#6569); встав, сессия снимает держание раньше.
 */
const WAKE_HOLD_MS = Number(process.env.ISKRON_OPENCODE_WAKE_HOLD_MS) || 6 * 3_600_000;

/**
 * Кадр дела в пачку: не прямое слово и не слово человека (его полёт и обрыв —
 * в пачку, как и его адресное слово не мне, #6081); запись дела, не
 * адресованная месту, — в пачку при любой стопке (#6574): текстом в ход
 * входит только адресованное, прочее уходит счётом в шапке.
 */
function toPile(frame: Frame | null): boolean {
  if (!frame || frame.type !== "message" || isDirectWord(frame)) return false;
  const rk = roomKind(frame);
  if (
    (frame.origin ?? classifyOrigin(frame)) === "human" &&
    !rk?.phase &&
    !rk?.aside &&
    !askFromPerson(frame)
  )
    return false;
  return !addressedToMine(frame) || stackOf(frame) === "batch"; // адресованность — до стопки: слово в полёте запоминается
}

/** Сколько неадресованных записей ждёт попутного промпта, не больше; старшие уходят. */
const RIDERS_MAX = 500;

interface Pile {
  session: string | null;
  child: boolean;
  held: Frame[];
  /** Пачки из одних счётов (#6574): хода не будят — едут счётом с ближайшим промптом в сессию. */
  riders: Frame[];
  timer: ReturnType<typeof setTimeout> | null;
  /** Промпт пачки в очереди сессии, ещё не взятый ходом; inbox null — ещё в полёте. */
  pending: { session: string; inbox: string | null; at: number } | null;
  /** Метки внесённого в эту сессию текстом (seen.ts deliveryKeys): счёт пачки их не повторит. */
  marks: Set<string>;
}

const MARKS_KEPT = 500;

/* eslint-disable @typescript-eslint/no-explicit-any -- уведомления моста без схемы */

export function setupChannel(ctx: Context, say: Say, freshestRoot: () => string | null): Channel {
  /** Сессия ещё принимает слово: существует и не в архиве. */
  async function accepting(id: string): Promise<boolean> {
    try {
      const info: any = await ctx.session.get({ sessionID: id } as any);
      return !(info?.time?.archived ?? info?.data?.time?.archived);
    } catch {
      return false;
    }
  }

  // Каждое вложение — строкой в лог с адресом и кадром, отказ — громко: кадр,
  // прочитанный мостом и не дошедший до хода, снаружи неотличим от глухоты,
  // а доска при этом говорит «слушает» (граф nks-dev: #4355).
  async function deliver(
    session: string | null,
    text: string,
    frame = "кадр",
    delivery: "steer" | "queue" = "steer",
    child = false,
  ): Promise<{ session: string; inbox: string | null } | null> {
    let id = session;
    if (child && (!id || !(await accepting(id)))) {
      // Место дочерней сессии пережило её: корню этот кадр не адресован — там
      // стоит другое стояние (#5167). Громко, и кадр остаётся в истории места.
      say(
        `Искрон: ${frame} на место дочерней сессии ${id ?? "?"}, которой больше нет, — корню не переадресую; ` +
          `кадр остаётся в истории стояния (iskron_channel history); место дочерней сессии — лишнее на канале, где корень стоит дальше: снимать ли его revoke, решай, зная цену (standing) —${text.slice(0, 120)}`,
        "error",
      );
      return null;
    }
    if (id && !(await accepting(id))) {
      say(
        `Искрон: сессия ${id} закрыта или в архиве — ${frame} идёт в свежайшую виденную`,
        "warning",
      );
      id = null;
    }
    id ??= freshestRoot();
    if (id && id !== session && !(await accepting(id))) id = null;
    if (!id) {
      say(
        `Искрон: ${frame} ВЛОЖИТЬ НЕКУДА — плагин не видел живой корневой сессии; кадр остаётся в истории стояния — ` +
          text.slice(0, 120),
        "error",
      );
      return null;
    }
    try {
      const r: any = await ctx.session.prompt({ sessionID: id, text, delivery });
      say(`Искрон: ${frame} вложен в сессию ${id}`, "info");
      const inbox = r?.id ?? r?.data?.id;
      return { session: id, inbox: typeof inbox === "string" ? inbox : null };
    } catch (e) {
      say(`Искрон: ${frame} не вложился в сессию ${id}: ${(e as Error).message}`, "error");
      return null;
    }
  }

  // Пачки дела — по мосту-адресату: копятся окном, а пока прежний промпт пачки
  // ждёт в очереди сессии — до его взятия. Кадр покидает пачку, только войдя в
  // отданный промпт.
  const piles = new Map<string, Pile>();
  const takenEarly = new Set<string>();
  // Слова платформы в промптах побудки, ждущих в очереди сессии (inbox → сессия и
  // текст промпта): такт внимания шлёт голове кадр в час, каждый со своим id, и
  // ход в несколько часов копил в очереди OpenCode те же слова подряд (#6569).
  // Пока промпт не взят, тот же промпт в очередь второй раз не встаёт; ключ —
  // весь текст, не тело: то же тело в другом деле — другое слово. О взятии
  // OpenCode может молчать — слово ждёт его не дольше своего предела (WAKE_HOLD_MS).
  const queuedWakes = new Map<string, { session: string; word: string; at: number }>();
  // Гасится только пачка из одного кадра: пачка показывает лишь первые кадры
  // окна, а мост метит отданными все — у пачки больше одного кадра непоказанное
  // ушло бы вместе с ней.
  /** Текст пачки из единственного кадра платформы; иначе null. */
  const platformWord = (ev: ChannelEvent): string | null => {
    const f = ev.frames?.length === 1 ? ev.frames[0] : null;
    return f && ev.text && (f.origin ?? classifyOrigin(f)) === "platform" ? ev.text : null;
  };
  const waiting = (session: string | null, word: string): boolean => {
    const id = session ?? freshestRoot();
    for (const [k, q] of queuedWakes) if (q.at + WAKE_HOLD_MS <= Date.now()) queuedWakes.delete(k);
    return [...queuedWakes.values()].some((q) => q.session === id && q.word === word);
  };

  function schedule(p: Pile): void {
    if (p.timer) clearTimeout(p.timer);
    const wait = p.pending
      ? Math.max(0, p.pending.at + PENDING_MAX_MS - Date.now())
      : CASE_BATCH_MS;
    p.timer = setTimeout(() => {
      p.timer = null;
      p.pending = null; // окно вышло либо OpenCode молчит о взятии дольше предела
      flush(p);
    }, wait);
    (p.timer as { unref?: () => void }).unref?.();
  }

  function flush(p: Pile): void {
    if (p.timer) clearTimeout(p.timer);
    p.timer = null;
    const frames = fresh(p, p.held.splice(0));
    if (!frames.length) return;
    // Пачка из одних счётов хода не будит (#6574): ждёт попутного промпта.
    if (!frames.some((f) => addressedToMine(f))) {
      p.riders.push(...frames);
      p.riders.splice(0, Math.max(0, p.riders.length - RIDERS_MAX));
      return;
    }
    const at = Date.now();
    p.pending = { session: "", inbox: null, at };
    const text = [
      batchHead([...fresh(p, p.riders.splice(0)), ...frames]),
      ...batchLines(frames),
    ].join("\n");
    void deliver(p.session, text, `пачка дела (${frames.length})`, "queue", p.child).then((got) => {
      // Без id взятия не увидеть: следующая пачка — по окну, не по взятию.
      const inbox = got?.inbox && !takenEarly.delete(got.inbox) ? got.inbox : null;
      p.pending = got && inbox ? { session: got.session, inbox, at } : null;
      if (p.held.length) schedule(p);
    });
  }

  function pile(session: string | null, child: boolean, frame: Frame): void {
    const key = `${child ? "child" : "root"}:${session ?? ""}`;
    let p = piles.get(key);
    if (!p)
      piles.set(
        key,
        (p = {
          session,
          child,
          held: [],
          riders: [],
          timer: null,
          pending: null,
          marks: new Set(),
        }),
      );
    if (frame.id && p.held.some((f) => f.id === frame.id)) return; // повтор ждущего
    p.held.push(frame);
    if (!p.pending && p.held.length >= CASE_BATCH_CAP) return flush(p);
    if (!p.timer) schedule(p);
  }

  /** Внесённое в сессию текстом — в метки её пачки. Только своя сессия: у чужой своя доставка. */
  function noteOwn(p: Pile | undefined, keys: string[] | undefined): void {
    if (!p) return;
    for (const k of keys ?? []) p.marks.add(k);
    for (const old of p.marks) if (p.marks.size > MARKS_KEPT) p.marks.delete(old);
  }

  /** Кадры пачки, чьё событие в сессию ещё не вошло (seen.ts eventIn). */
  const fresh = (p: Pile, fs: Frame[]): Frame[] =>
    fs.filter((f) => !eventIn(f, (k) => p.marks.has(k)));

  /** Счёт попутных записей пачек — строками шапки; пачки отдают их. */
  function riding(ps: Pile[]): string[] {
    const got = ps.flatMap((p) => fresh(p, p.riders.splice(0)));
    return got.length ? [batchHead(got)] : [];
  }

  function loud(session: string | null, text: string, child = false): void {
    say(text, "error");
    void deliver(session, text, "кадр", "steer", child);
  }

  return {
    taken(session, inbox) {
      if (inbox) queuedWakes.delete(inbox);
      else for (const [k, q] of queuedWakes) if (q.session === session) queuedWakes.delete(k);
      let matched = false;
      for (const p of piles.values()) {
        if (!p.pending || (inbox ? p.pending.inbox !== inbox : p.pending.session !== session))
          continue;
        matched = true;
        p.pending = null;
        flush(p); // накопленное за ходом уже подождало — уходит сейчас
      }
      // Взятие обогнало ответ на prompt: id запоминается, пачка сверит его по ответу.
      if (inbox && !matched) {
        takenEarly.add(inbox);
        for (const old of takenEarly) if (takenEarly.size > 100) takenEarly.delete(old);
      }
    },
    stop() {
      for (const p of piles.values()) {
        p.pending = null;
        flush(p);
      }
    },
    ride(session) {
      const own = [...piles.values()].filter(
        (p) => !p.child && (p.session === session || (!p.session && freshestRoot() === session)),
      );
      return riding(own).join("\n") || null;
    },
    onEvent(session, params: any, child = false) {
      const ev = params?.data as ChannelEvent | undefined;
      if (!ev || typeof ev !== "object") return;
      switch (ev.kind) {
        case "frame": {
          const frame = ev.frame ?? null;
          // Служебные кадры не будят: hello доказывает, что сокет держат, и только.
          if (frame?.type === "hello") return say("Искрон: канал слушает", "info");
          if (frame?.type === "status") return;
          // Путь кадра (#5851): с event_kind — правило рода, без него — своя стопка
          // кадра, как прежде (#4957); пачка — одним промптом очередью, прочее — вставкой.
          if (frame && toPile(frame)) return pile(session, child, frame);
          const own = piles.get(`${child ? "child" : "root"}:${session ?? ""}`);
          noteOwn(own, deliveryKeys(frame)); // кадр входит текстом — счёт пачки его не повторит
          void deliver(
            session,
            [...riding(own ? [own] : []), frameToText(frame, ev.raw ?? "")].join("\n"),
            `кадр ${frame?.id ?? "без id"}`,
            "steer",
            child,
          );
          return;
        }
        // Слово моста ребёнка — только ему (child): корню оно не адресовано (#6625).
        case "dead":
          loud(
            session,
            `Искрон: канал закрыт кодом ${ev.code} — токен мёртв. Зови iskron_channel(action="connect")` +
              ", затем register тем же именем: новый сокет мост возьмёт из ответа сам, перезапуск не нужен.",
            child,
          );
          return;
        case "stale":
          noteOwn(piles.get(`${child ? "child" : "root"}:${session ?? ""}`), ev.marks);
          if (ev.text) void deliver(session, ev.text, "пачка лежалых кадров", "queue", child); // одна пачка — один промпт
          return;
        case "backlog":
          noteOwn(piles.get(`${child ? "child" : "root"}:${session ?? ""}`), ev.marks);
          // Побудка с накопленным — один промпт на пачку, не ход на кадр (#5140).
          // Очередью — сознательная развилка: пачка в полтора десятка кадров,
          // вставленная посреди хода, режет работу делателя; одним промптом она
          // по одному за ход не всплывёт, а ждёт лишь конца текущего хода.
          if (ev.text) {
            const word = platformWord(ev);
            if (word !== null && waiting(session, word))
              return say(
                "Искрон: пачка побудки повторяет слово, ждущее в очереди сессии, — второй раз не вкладываю",
                "info",
              );
            void deliver(
              session,
              ev.text,
              `пачка побудки (${ev.frames?.length ?? 0})`,
              "queue",
              child,
            ).then((got) => {
              // Без id взятия не увидеть — повтор такого промпта не гасится.
              if (word === null || !got?.inbox || takenEarly.delete(got.inbox)) return;
              queuedWakes.set(got.inbox, { session: got.session, word, at: Date.now() });
              for (const k of queuedWakes.keys()) if (queuedWakes.size > 100) queuedWakes.delete(k);
            });
          }
          return;
        case "lost":
          // Держащий мост вышел или прежний плагин остановили: громко, в сессию.
          if (ev.text) loud(session, ev.text, child);
          return;
        case "resumed":
          // Мост вернул место сам (#5366): занятое имя — в сессию, как и потеря слуха.
          if (ev.text) {
            say(ev.text, "warning");
            void deliver(session, ev.text, "слово о возвращённом месте", "steer", child);
          }
          return;
        case "held":
          say(`Искрон: мост держит стояние ${ev.key ?? ""}`, "info");
          return;
        case "released":
          say(`Искрон: мост отпустил стояние ${ev.key ?? ""} — ${ev.text ?? ""}`, "warning");
          return;
        case "evicted":
          loud(
            session,
            `Искрон: канал закрыт кодом ${ev.code} — место отняли, слушает другой держатель. ` +
              "Мост сам встаёт рядом на имя.N со слухом — своё место, чужое не перехватывается; исход — следующим словом, место и команду сторожа скажет iskron_stand тем же вызовом. Вытеснить ту сессию (take=true) — только словом человека.",
            child,
          );
          return;
        case "alive":
          loud(
            session,
            `Искрон: сокет рвут, а служба отвечает (${ev.version ?? ""}) — мост держит место и переоткрывает реже; ` +
              "не пройдёт — спроси о токене.",
            child,
          );
          return;
        case "note":
          if (ev.text) say(`Искрон: ${ev.text}`, "warning");
          return;
        default:
          return;
      }
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
