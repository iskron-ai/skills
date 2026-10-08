// Слова моста о впитанных ответах канала (граф @nks/nks-dev: #4233, #5033, #5838):
// вырезанные адреса сокета и статуса, отказ снять основное место канала.
import type { Lang } from "../lang.ts";

export interface AbsorbWords {
  /** На месте вырезанного адреса сокета. */
  socketHidden: () => string;
  /** На месте вырезанного статусного адреса. */
  statusHidden: () => string;
  /** Основное место не снято: на канале стоят места других графов; held — их ключи через запятую. */
  mainSeatHeld: (name: string | null | undefined, held: string) => string;
}

export const ABSORB: Readonly<Record<Lang, AbsorbWords>> = {
  ru: {
    socketHidden: () => "(адрес сокета держит мост — агенту не показывается)",
    statusHidden: () => "(статусный адрес держит мост)",
    mainSeatHeld: (name, held) =>
      `[iskron-bridge] ${name ?? "это место"} — основное место канала моста, а на канале стоят места других графов: ${held}. Мост ничего не отпустил; снять основное — сперва сними их (revoke в их графе).`,
  },
  en: {
    socketHidden: () => "(the bridge holds the socket address — it is not shown to the agent)",
    statusHidden: () => "(the bridge holds the status address)",
    mainSeatHeld: (name, held) =>
      `[iskron-bridge] ${name ?? "this seat"} is the main seat of the bridge's channel, and seats of other graphs stand on the channel: ${held}. The bridge released nothing; to remove the main one, first remove them (revoke in their graph).`,
  },
};
