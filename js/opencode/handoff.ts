// Передача спутника ребёнка, перенесённого одного в другую папку (граф nks-dev: #6695).
// Его спутник — экземпляру той папки, как корень при переносе и как при перезагрузке
// (children.ts): пауза моста, маркер с меткой новой папки (ключ, место корня, дело, ход),
// мост здесь гаснет. Ведущий не кончается — ни «КОНЧЕН», ни снятия места: экземпляр новой
// папки возвращает место по ключу тем же спутником.
import { method } from "../delivery/index.ts";
import { authDir } from "./bridge-io.ts";
import { PAUSE_MS } from "./children.ts";
import type { Leads } from "./leadwords.ts";
import { writeLostMarker } from "./marker.ts";
import type { Home } from "./records.ts";
import type { Slot } from "./slot.ts";
import { adoptIn, handOver } from "./twins.ts";

export interface HandoffDoors {
  slots: Map<string, Slot>;
  leads: Leads;
  /** Мост сессии гасится здесь; место не снимается (ребёнок уехал в другую папку). */
  forget(session: string): void;
}

/** Ребёнок-спутник перенесён из home в to — передать; не тот случай — false. */
export const createHandoff =
  (d: HandoffDoors) =>
  (session: string, to: Home | null, home: Home | null): boolean => {
    const s = d.slots.get(session);
    if (!s?.child || !s.satelliteOf || !s.holding) return false;
    if (!home || !to?.directory || to.directory === home.directory) return false;
    const was = d.leads.handoff(session);
    [s.room, s.noted, s.last] = [was.room, was.noted, was.last];
    // Вызовы ребёнка в новой папке ждут маркера (children.ts, settled), а не встают вторым спутником.
    handOver(
      session,
      s.bridge
        .request(method("suspend"), {}, { timeoutMs: PAUSE_MS, service: true })
        .catch(() => {})
        .then(() => {
          writeLostMarker(authDir(), [s], to);
          d.forget(session);
          adoptIn(to); // живой экземпляр новой папки берёт маркер сразу (twins.ts)
        }),
    );
    return true;
  };
