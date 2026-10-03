// Записи маркера своей локации (marker.ts) — что с ними делает экземпляр плагина:
// корням — подсказки возврата (keep.ts); ребёнок-спутник — обратно по ключу
// (children.ts); ребёнок на обычном мосте — его прогон кончен. Ребёнок корня,
// перенесённого в другую папку (moves.ts), кончен переносом: прежний экземпляр погасил
// его мост и снял место (OpenCode детей с родителем не переносит). Здесь его запись —
// громкий отказ, не слот корня: она ушла бы местом родителя (граф nks-dev: #6550,
// правила 1-2; #6361); его revoke отсюда не посылается — снимать уже нечего.
import type { Keeper } from "./keep.ts";
import { takeLostMarker } from "./marker.ts";
import type { Home, LostEntry } from "./records.ts";
import type { Slot } from "./tools.ts";

export interface AdoptDoors {
  keeper: Keeper<Slot>;
  authDir: () => string;
  home: Home | null;
  /** Ребёнок-спутник прежнего экземпляра — обратно по ключу (children.ts). */
  back(e: LostEntry): Promise<void>;
  /** Ребёнок кончен в этом экземпляре: запись — отказ вслух с этим словом. */
  endKid(session: string, of: LostEntry["of"], why: string): void;
}

const movedWhy = (name?: string) =>
  `поручение этой дочерней сессии кончено переносом родителя в другую папку: её место${name ? ` ${name}` : ""} снято, мост погашен; запись отсюда ушла бы местом родителя`;

export function createAdopt(d: AdoptDoors) {
  const moved = new Map<string, string>(); // имя места ребёнка перенесённого корня → его сессия

  function take(entries: LostEntry[]): void {
    d.keeper.hint(entries);
    for (const e of entries) {
      if (!e.child || !e.session) continue;
      if (!e.moved) void d.back(e);
      else {
        if (e.name) moved.set(e.name, e.session);
        d.endKid(e.session, e.of ?? null, movedWhy(e.name));
      }
    }
  }

  return {
    take,
    /** Сессию перенесли сюда при живом экземпляре: маркер переноса, положенный прежним, — взять. */
    now(): void {
      const lost = takeLostMarker(d.authDir(), d.home);
      if (!lost) return;
      take(lost.entries);
      void d.keeper.resumeLost(lost.entries, lost.wordFor);
    },
    /** revoke места ребёнка, кончённого переносом родителя: ответ плагина вместо вызова. */
    revoked(name: string, args: Record<string, unknown>): string | null {
      const s = String(args.standing ?? "").trim();
      if (name !== "iskron_channel" || args.action !== "revoke" || !s) return null;
      for (const n of moved.keys())
        if (s === n || s.endsWith(`:${n}`))
          return (
            `Искрон: ${n} — субагент, кончённый переносом родителя: прежний экземпляр погасил его мост и снял место, ` +
            "итог лёг родителю словом «перенесён»; revoke не нужен и не послан."
          );
      return null;
    },
  };
}
