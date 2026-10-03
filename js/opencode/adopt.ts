// Записи маркера своей локации (marker.ts) — что с ними делает экземпляр плагина:
// корням — подсказки возврата (keep.ts); ребёнок-спутник — обратно по ключу
// (children.ts); ребёнок на обычном мосте — его прогон кончен. Ребёнок, перенесённый
// вместе с родителем в другую папку (moves.ts), — громкий отказ его записей, а не
// слот корня: его мост и место остались у экземпляра прежней папки, и запись ушла
// бы местом родителя (граф nks-dev: #6550, правила 1-2; #6361). Его revoke отсюда идёт
// мостом корня как есть, но не молча: итога «КОНЧЕН» здесь не будет.
import type { Keeper } from "./keep.ts";
import { type Home, type LostEntry, takeLostMarker } from "./marker.ts";
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
  `эта дочерняя сессия перенесена с родителем в другую папку, её место${name ? ` ${name}` : ""} и мост остались у экземпляра прежней папки; запись отсюда ушла бы местом родителя`;

export function createAdopt(d: AdoptDoors) {
  const moved = new Map<string, string>(); // имя места перенесённого ребёнка → его сессия

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
      void d.keeper.resumeLost(lost.entries, lost.text);
    },
    /** revoke места перенесённого ребёнка — слово к ответу. */
    revokeNote(name: string, args: Record<string, unknown>): string | null {
      const s = String(args.standing ?? "").trim();
      if (name !== "iskron_channel" || args.action !== "revoke" || !s) return null;
      for (const n of moved.keys())
        if (s === n || s.endsWith(`:${n}`))
          return (
            `Искрон: ${n} — субагент, перенесённый с родителем: его мост у экземпляра прежней папки, ` +
            "здесь он не ведущий — revoke ушёл как есть, итога «КОНЧЕН» отсюда не будет."
          );
      return null;
    },
  };
}
