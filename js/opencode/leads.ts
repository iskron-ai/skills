// Ведущий субагент (граф nks-dev: #6625; #6550, правило 4): дочерняя сессия,
// вставшая своим местом, живёт до исхода поручения, а не до конца хода. OpenCode
// держит её после хода живой, кадр её дела будит её сессию (channel.ts), и
// конец — явный акт: её уход по исходу (leave дела поручения — первого, куда она
// вошла, — уход из дел целиком либо iskron_channel leave), слово запустившего
// (его revoke её места — окончательно), удаление сессии — или потолок простоя
// забытого. Перезагрузка плагина — не конец: ребёнок возвращается (children.ts).
// На конце мост ребёнка гасится (выход из дел и снятие места — его, bridge/session.ts),
// итог — синтетикой родителю. Договор и слова — leadwords.ts.

import * as W from "./leadwords.ts";
import { type Place, standsBy } from "./satellite.ts";

/** Простой ведущего субагента без хода и без кадра, после которого плагин снимает его сам. */
const LEAD_IDLE_MS = Number(process.env.ISKRON_LEAD_IDLE_MS) || 45 * 60_000;
const TICK_MS = Math.min(60_000, Math.max(100, Math.floor(LEAD_IDLE_MS / 5)));
/** События хода — простой считается от них и от кадров, не от любого события сессии. */
const TURN = /^session\.execution\.(started|succeeded|failed)$/;

interface Lead {
  parent: Promise<string | null>;
  at: number;
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
  const gone = new Set<string>(); // отпущенные запустившим
  const who = (l: Lead, child: string): string => l.place?.name ?? `сессии ${child}`;
  const parentOf = (child: string) => d.parentOf(child).catch(() => null);

  /**
   * Конец: мост гасится (ended), родителю — итог; wake — будить ли его ходом: итог
   * будит, потолок и невозвращённое место — нет, их слово ждёт его следующего хода.
   */
  async function finish(child: string, why: string, ended = true, wake = true, lost = false) {
    const l = leads.get(child);
    if (!l) return;
    leads.delete(child);
    if (ended) await d.end(child).catch(() => {});
    const parent = await l.parent;
    const word = lost
      ? W.lostWord(who(l, child), why)
      : W.endWord(who(l, child), why, (l.last ?? "").trim());
    if (parent) await d.tell(parent, word, wake);
    else d.say(`${word}\n(родителя плагин не знает — итог некому)`, "warning");
  }

  function leave(child: string, l: Lead, why: string): void {
    l.leaving = why;
    if (!l.running) void finish(child, why);
  }

  function stood(child: string): Lead {
    const l = leads.get(child) ?? { parent: parentOf(child), at: Date.now() };
    leads.set(child, l);
    return l;
  }

  function touch(l: Lead | undefined, place?: Place | null): l is Lead {
    if (!l) return false;
    l.at = Date.now();
    if (place) l.place = place;
    return true;
  }

  const tick = setInterval(() => {
    const now = Date.now();
    const why = `потолок простоя: ${Math.round(LEAD_IDLE_MS / 60_000)} мин без хода и без кадра`;
    for (const [child, l] of leads)
      if (!l.running && now - l.at >= LEAD_IDLE_MS) void finish(child, why, true, false);
  }, TICK_MS);
  tick.unref?.();

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
        gone.add(child);
        await finish(child, "отпущен словом запустившего");
        await d.tell(child, W.releasedWord(), false);
        return W.releaseWord(who(l, child));
      }
      return null;
    },
    released: (child) => gone.has(child),
    heard(child, kind, place) {
      if (kind !== "held" && kind !== "frame") return;
      touch(kind === "held" && !gone.has(child) ? stood(child) : leads.get(child), place);
    },
    back(child, room) {
      const l = stood(child);
      if (room) l.room = room;
    },
    fail: (child, why) => finish(child, why, true, false, true),
    roomOf: (child) => leads.get(child)?.room ?? null,
    onEvent(ev) {
      const child: unknown = ev?.data?.sessionID;
      const l = typeof child === "string" ? leads.get(child) : undefined;
      if (!l || typeof child !== "string") return;
      if (TURN.test(String(ev.type))) l.at = Date.now();
      switch (ev.type) {
        case "session.execution.started":
          l.running = true;
          return;
        case "session.text.ended":
          if (typeof ev.data?.text === "string" && ev.data.text.trim()) l.last = ev.data.text;
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
    stop: () => clearInterval(tick),
  };
}
