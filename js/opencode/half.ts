// Половина «тулы» снаружи (tools.ts) — то, чем plugin.ts её зовёт, и её пустая
// форма: мост не найден или половина не встала, а плагин грузится дальше.
/* eslint-disable @typescript-eslint/no-explicit-any -- события SDK без схемы */
import type { Bridge } from "../shared/bridge-client.ts";
import type { Home } from "./records.ts";

export interface ToolsHalf {
  /** Сессия умерла — её мост отпускается вместе со стоянием. */
  forget(session: string): void;
  /** Событие сервиса: ход, текст, удаление ведущего субагента (leads.ts, #6625). */
  onEvent(ev: any): void;
  /** Первый промпт сессии — строка запуска с делом исполняется до хода модели (launch.ts). */
  launch(session: string, text: string): Promise<string | null>;
  stop(): void | Promise<void>;
  bridgeOf(session: string): Bridge | null; // мост держащего слота — для расхода сессии (usage.ts)
  /** Имя места живого ведущего субагента; не ведущий — null (notice.ts). */
  leadOf(session: string): string | null;
  /** Сессии с занятым местом — корень, ведущий спутник; корни первыми (keepalive.ts). */
  holders(): string[];
  /** У сессии есть мост этого экземпляра — она в его каталоге (keepalive.ts). */
  owns(session: string): boolean;
  /** Сессию перенесли в локацию to (событие session.moved). */
  moved(session: string, to: Home | null): void;
}

export const idleHalf = (): ToolsHalf => ({
  forget() {},
  onEvent() {},
  launch: async () => null,
  stop() {},
  bridgeOf: () => null,
  leadOf: () => null,
  holders: () => [],
  owns: () => false,
  moved() {},
});

/* eslint-enable @typescript-eslint/no-explicit-any */
