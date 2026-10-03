// Отмена хода родителя — не отмена ребёнка (граф nks-dev: #6625; дело №147 [150]).
// OpenCode 2.0.22 (packages/core/src/tool/plugin/subagent.ts): task-тул с background=false
// ждёт ребёнка в jobs.block, и прерывание хода родителя зовёт onInterrupt →
// sessions.interrupt(child) без причины, то есть «user». Событие ребёнка — тот же
// session.execution.interrupted { reason: "user" }, что у прямой отмены: в data иного
// признака нет. Различает родитель: при каскаде его ход прерван тем же «user» рядом по
// времени (порядок двух событий не держится — оба публикует settle своего исполнения);
// при прямой отмене ребёнка ход родителя идёт дальше — его task-тул получает «Subagent cancelled».
/* eslint-disable @typescript-eslint/no-explicit-any -- события SDK без схемы */
import { sleep } from "./bridge-io.ts";

/** Окно, в котором прерывание родителя и ребёнка считаются одной отменой. */
const WINDOW_MS = Number(process.env.ISKRON_CASCADE_MS) || 3_000;

export interface Cascade {
  /** Всякое событие сервиса: прерывания с reason «user» запоминаются по сессии. */
  note(ev: any): void;
  /** Ход ребёнка, прерванный в t, оборван отменой хода его родителя — ждёт до окна. */
  byParent(parent: Promise<string | null>, t: number): Promise<boolean>;
}

export function createCascade(): Cascade {
  const cut = new Map<string, number>();
  return {
    note(ev) {
      const s: unknown = ev?.data?.sessionID;
      if (ev?.type !== "session.execution.interrupted" || ev.data?.reason !== "user") return;
      if (typeof s !== "string") return;
      const now = Date.now();
      for (const [k, at] of cut) if (now - at > 2 * WINDOW_MS) cut.delete(k);
      cut.set(s, now);
    },
    async byParent(parent, t) {
      const p = await parent.catch(() => null);
      if (!p) return false;
      const near = (): boolean => {
        const at = cut.get(p);
        return at !== undefined && Math.abs(at - t) <= WINDOW_MS;
      };
      while (!near() && Date.now() - t < WINDOW_MS) await sleep(50);
      return near();
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
