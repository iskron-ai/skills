// Ведущий субагент (граф nks-dev: #6625; #6550, правило 4): дочерняя сессия,
// вставшая своим местом, живёт до исхода поручения, а не до конца хода. OpenCode
// держит её после хода живой, кадр её дела будит её сессию (channel.ts), и
// конец — явный акт: её уход по исходу (leave дела поручения — первого, куда она
// вошла, — либо iskron_channel leave), слово запустившего (его revoke её места),
// удаление сессии — или потолок простоя забытого. На конце мост ребёнка гасится
// (его уход выводит из дел и снимает место, bridge/session.ts), итог — синтетикой родителю.
/* eslint-disable @typescript-eslint/no-explicit-any -- события сервиса без схемы */
import { endWord, type LeadDoors, lostWord, releaseWord, turnWord } from "./leadwords.ts";
import { type Place, standsBy } from "./satellite.ts";

/** Простой ведущего субагента без хода и без кадра, после которого плагин снимает его сам. */
const LEAD_IDLE_MS = Number(process.env.ISKRON_LEAD_IDLE_MS) || 45 * 60_000;
const TICK_MS = Math.min(60_000, Math.max(100, Math.floor(LEAD_IDLE_MS / 5)));

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

export interface Leads {
  /**
   * Успешный вызов ребёнка его мостом: встал — он ведущий; первое дело, куда вошёл
   * (строка запуска входит первой), — дело поручения; уход по исходу кончает его.
   */
  called(child: string, name: string, args: Record<string, unknown>, place?: Place | null): void;
  /** revoke запустившего, называющий место его ведущего субагента; null — не этот случай. */
  release(caller: string, name: string, args: Record<string, unknown>): Promise<string | null>;
  /** Слово моста ребёнка: «held» называет место, кадр — не простой. */
  heard(child: string, kind: unknown, place?: Place | null): void;
  /** Дети, державшие место у прежнего экземпляра плагина: их мост ушёл с ним — слово родителю. */
  lost(entries: { session: string; key: string | null; child?: boolean }[]): string[];
  onEvent(ev: any): void;
  stop(): void;
}

const roomNo = (room: unknown): string => String(room ?? "").replace(/^\s*[#№]\s*|\s+$/g, "");
const names = (place: Place | undefined, child: string, s: string): boolean =>
  s === child || (!!place?.name && (s === place.name || s.endsWith(`:${place.name}`)));

export function createLeads(d: LeadDoors): Leads {
  const leads = new Map<string, Lead>();
  const who = (l: Lead, child: string): string => l.place?.name ?? `сессии ${child}`;
  const parentOf = (child: string) => d.parentOf(child).catch(() => null);

  async function finish(child: string, why: string, gone = false): Promise<void> {
    const l = leads.get(child);
    if (!l) return;
    leads.delete(child);
    if (!gone) await d.end(child).catch(() => {});
    const parent = await l.parent;
    const word = endWord(who(l, child), why, (l.last ?? "").trim());
    if (parent) await d.tell(parent, word, true);
    else d.say(`${word}\n(родителя плагин не знает — итог некому)`, "warning");
  }

  function leave(child: string, l: Lead, why: string): void {
    l.leaving = why;
    if (!l.running) void finish(child, why);
  }

  /** Ребёнок встал своим мостом — он ведущий. */
  function stood(child: string): Lead {
    const l = leads.get(child) ?? { parent: parentOf(child), at: 0 };
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
      if (!l.running && now - l.at >= LEAD_IDLE_MS) void finish(child, why);
  }, TICK_MS);
  tick.unref?.();

  return {
    called(child, name, args, place) {
      const l = standsBy(name, args) ? stood(child) : leads.get(child);
      if (!touch(l, place)) return;
      const room = name === "iskron_case" || name === "iskron_room" ? roomNo(args.room) : "";
      if (args.action === "join" && room) l.room ??= room;
      if (args.action !== "leave") return;
      if (name === "iskron_channel") leave(child, l, "ушёл с места по исходу");
      else if (room && room === l.room) leave(child, l, `вышел из дела №${l.room} по исходу`);
    },
    async release(caller, name, args) {
      const s = String(args.standing ?? "").trim();
      if (name !== "iskron_channel" || args.action !== "revoke" || !s) return null;
      for (const [child, l] of leads) {
        if (!names(l.place, child, s) || (await l.parent) !== caller) continue;
        await finish(child, "отпущен словом запустившего");
        return releaseWord(who(l, child));
      }
      return null;
    },
    heard(child, kind, place) {
      touch(kind === "held" ? stood(child) : leads.get(child), place);
    },
    lost(entries) {
      const children = entries.filter((e) => e.child && e.session);
      for (const e of children)
        void parentOf(e.session).then(async (p) => {
          if (p) await d.tell(p, lostWord(e.key ?? e.session), false);
        });
      return children.map((e) => e.session);
    },
    onEvent(ev) {
      const child: unknown = ev?.data?.sessionID;
      const l = typeof child === "string" ? leads.get(child) : undefined;
      if (!touch(l) || typeof child !== "string") return;
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
            if (p && leads.has(child)) await d.tell(p, turnWord(l.place?.name ?? child), false);
          });
          return;
        case "session.deleted":
          return void finish(child, "сессия субагента удалена", true);
      }
    },
    stop: () => clearInterval(tick),
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
