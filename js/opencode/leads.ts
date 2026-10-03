// Ведущий субагент (граф nks-dev: #6625; #6550, правило 4): дочерняя сессия,
// вставшая своим местом, живёт до исхода поручения, а не до конца хода. OpenCode
// держит её после хода живой, кадр её дела будит её сессию (channel.ts), и
// конец — явный акт: её уход по исходу (leave дела поручения — первого, куда она
// вошла, — уход из дел целиком либо iskron_channel leave), слово запустившего
// (его revoke её места — окончательно), отмена её хода в OpenCode — тоже окончательно (не отмена хода родителя, оборвавшая
// её ход каскадом, — cascade.ts),
// удаление сессии. Потолка простоя нет: ожидание человека — не забытость, забытого
// снимает запустивший. Перезагрузка плагина — не конец: ребёнок возвращается (children.ts).
// На конце мост ребёнка гасится (выход из дел и снятие места — его, bridge/session.ts),
// итог — синтетикой родителю. Договор и слова — leadwords.ts.

import { createCascade } from "./cascade.ts";
import * as W from "./leadwords.ts";
import { type Place, standsBy } from "./satellite.ts";

interface Lead {
  parent: Promise<string | null>;
  place?: Place;
  room?: string; // дело поручения — номер без знака
  running?: boolean;
  noted?: boolean;
  leaving?: string; // уход сказан посреди хода — конец ждёт конца хода и его текста
  last?: string;
}

const roomNo = (room: unknown): string => String(room ?? "").replace(/^\s*[#№]\s*|\s+$/g, "");
const names = (place: Place | undefined, child: string, s: string): boolean =>
  s === child || (!!place?.name && (s === place.name || s.endsWith(`:${place.name}`)));

export function createLeads(d: W.LeadDoors): W.Leads {
  const leads = new Map<string, Lead>();
  // Кончённые окончательно: отпущенные запустившим (причины нет — слово отказа о нём),
  // отменённые, снятые платформой — с причиной, которую назовёт отказ ребёнку.
  const gone = new Map<string, string | undefined>();
  const over = new Set<string>(); // кончённые любым концом, пока не встали снова
  const cascade = createCascade();
  const who = (l: Lead, child: string): string => l.place?.name ?? `сессии ${child}`;
  const parentOf = (child: string) => d.parentOf(child).catch(() => null);

  /**
   * Конец: мост кончает прогон (ended), родителю — итог с исходом снятия места, затем мост гасится. Итог будит и идёт steer: родная
   * синтетика OpenCode по затиханию ребёнка будит родителя первой, и слово с queue
   * легло бы лишь после его хода; steer ложится в идущий ход на ближайшей границе шага.
   * Порядок двух синтетик плагин не держит. Отмена, невозвращённое место (lost) и
   * перенос родителя (away — без «КОНЧЕН»: итог не по исходу поручения) не будят; все
   * слова — steer (leadwords.ts): queue в занятого родителя запускал после хода ещё один (e2e).
   */
  async function finish(
    child: string,
    why: string,
    ended = true,
    wake = true,
    kind: "end" | "lost" | "away" = "end",
  ) {
    const l = leads.get(child);
    if (!l) return;
    leads.delete(child);
    over.add(child);
    // Конец снимает только спутника ребёнка: обычное место, вставшее вместо него, не трогаем.
    const kept = ended && kind === "end" ? d.ownPlace(child) : null;
    if (kept) d.say(`Искрон: ${W.keptLine(who(l, child), kept)}`, "warning");
    const parent = await l.parent;
    const last = (l.last ?? "").trim();
    // Мост кончает прогон до слова — «место снято» только по его ответу (e2e12, №147), — а
    // гаснет после: слово ложится раньше родной синтетики OpenCode о затихшем ребёнке.
    const failed = ended && !kept ? await d.close(child).catch(() => null) : [];
    const word =
      kind === "lost"
        ? W.lostWord(who(l, child), why)
        : kind === "away"
          ? W.awayWord(who(l, child), last)
          : W.endWord(who(l, child), why, last, kept, failed);
    if (parent) await d.tell(parent, word, wake);
    else d.say(`${word}\n(родителя плагин не знает — итог некому)`, "warning");
    if (ended && !kept)
      await d
        .end(child)
        .catch((e: Error) =>
          d.say(
            `Искрон: мост субагента ${who(l, child)} не погашен после итога — ${e.message}`,
            "warning",
          ),
        );
  }

  function leave(child: string, l: Lead, why: string): void {
    l.leaving = why;
    if (!l.running) void finish(child, why);
  }

  function stood(child: string): Lead {
    const l = leads.get(child) ?? { parent: parentOf(child) };
    leads.set(child, l);
    over.delete(child);
    return l;
  }

  function touch(l: Lead | undefined, place?: Place | null): l is Lead {
    if (!l) return false;
    if (place) l.place = place;
    return true;
  }

  return {
    called(child, name, args, place) {
      if (gone.has(child)) return;
      const l = standsBy(name, args) ? stood(child) : leads.get(child);
      if (!touch(l, place)) return;
      const room = name === "iskron_case" || name === "iskron_room" ? roomNo(args.room) : null;
      if (args.action === "join" && room) l.room ??= room;
      if (args.action !== "leave") return;
      if (name === "iskron_channel") leave(child, l, "ушёл с места по исходу");
      else if (room === "") leave(child, l, "ушёл из дел по исходу");
      else if (room && room === l.room) leave(child, l, `вышел из дела №${l.room} по исходу`);
    },
    async release(caller, name, args) {
      const s = String(args.standing ?? "").trim();
      if (name !== "iskron_channel" || args.action !== "revoke" || !s) return null;
      for (const [child, l] of leads) {
        if (!names(l.place, child, s) || (await l.parent) !== caller) continue;
        if (d.ownPlace(child)) return null; // не спутник — revoke идёт мостом запустившего как есть
        gone.set(child, undefined);
        await finish(child, "отпущен словом запустившего");
        await d.tell(child, W.releasedWord(), false);
        return W.releaseWord(who(l, child));
      }
      return null;
    },
    released: (child) => gone.has(child),
    goneWhy: (child) => gone.get(child),
    heard(child, kind, place) {
      // Место-спутник снято платформой (вытеснено, закрыто 4001): мост без места жнец погасил
      // бы молча — конец, как revoke запустившего: родителю слово без пробуждения, встать нельзя.
      // Слово моста о канале ребёнку не идёт (true): он кончен, звать connect ему нечего.
      if ((kind === "evicted" || kind === "dead") && leads.has(child) && !d.ownPlace(child)) {
        gone.set(child, W.placeGoneRefusal(kind));
        void finish(child, W.placeGone(kind), true, false);
        return true;
      }
      if (gone.has(child)) return true;
      if (kind === "held") {
        over.delete(child); // встал заново — снова ведущий
        touch(stood(child), place);
        return false;
      }
      if (over.has(child)) return true; // кончен любым концом — слов о канале ему нет
      if (kind === "frame") touch(leads.get(child), place);
      return false;
    },
    back(child, was) {
      const l = stood(child);
      if (was.room) l.room = was.room;
      if (was.noted) l.noted = true; // ход родителю уже назван прежним экземпляром
      if (was.last) l.last ??= was.last; // итог по концу — и после перезагрузки
      if (was.name && was.of) l.place ??= { ...was.of, name: was.name }; // revoke по имени до «held»
    },
    fail: (child, why) => finish(child, why, true, false, "lost"),
    away: (child) => finish(child, "", true, false, "away"),
    snapshot: (child) => {
      const l = leads.get(child);
      return { room: l?.room ?? null, noted: !!l?.noted, last: l?.last };
    },
    nameOf: (child) => leads.get(child)?.place?.name ?? (leads.has(child) ? child : null),
    onEvent(ev) {
      cascade.note(ev); // прерывания всех сессий: родитель ведущего — тоже (cascade.ts)
      const child: unknown = ev?.data?.sessionID;
      const l = typeof child === "string" ? leads.get(child) : undefined;
      if (!l || typeof child !== "string") return;
      switch (ev.type) {
        case "session.execution.started":
          l.running = true;
          return;
        case "session.text.ended":
          if (typeof ev.data?.text === "string" && ev.data.text.trim()) l.last = ev.data.text;
          return;
        case "session.execution.interrupted":
          l.running = false;
          // Отмена хода самого ребёнка (reason "user") — конец, как revoke запустившего:
          // без пробуждения, встать снова нельзя; shutdown, superseded, inactivity — не отмена.
          // Тот же «user» каскадом от отмены хода родителя — лишь снятый ход (cascade.ts).
          if (ev.data?.reason !== "user") return;
          void cascade.byParent(l.parent, Date.now()).then(async (byParent) => {
            if (!leads.has(child)) return;
            if (byParent) {
              const p = await l.parent;
              if (p) await d.tell(p, W.cascadeWord(who(l, child)), false);
              return;
            }
            gone.set(child, W.CANCELLED_REFUSAL);
            await finish(child, W.CANCELLED, true, false);
          });
          return;
        case "session.execution.succeeded":
        case "session.execution.failed":
          l.running = false;
          if (l.leaving) return void finish(child, l.leaving);
          if (l.noted) return;
          l.noted = true; // первый ход сдан: родителю — что это ход, не итог
          void l.parent.then(async (p) => {
            if (p && leads.has(child)) await d.tell(p, W.turnWord(l.place?.name ?? child), false);
          });
          return;
        case "session.deleted":
          return void finish(child, "сессия субагента удалена", false);
      }
    },
  };
}
