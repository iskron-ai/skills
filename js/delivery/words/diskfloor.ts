// Слово отказа тяжёлой работы на почти полном томе (граф @nks/nks-dev, узел #11288): подъём
// агента оркестратором, субагент и команда сборки — с названным ходом уборки.
import type { Lang } from "../lang.ts";

export interface DiskFloorWords {
  /** free, total — ГБ готовой строкой; pct — доля свободного; floor — пол; move — слово хода. */
  refused: (
    path: string,
    free: string,
    total: string,
    pct: string,
    floor: string,
    move: string,
  ) => string;
  /** Ход: подъём агента оркестратором. */
  moveRaise: () => string;
  /** Ход: запуск субагента. */
  moveSubagent: () => string;
  /** Ход: команда сборки. */
  moveBuild: (command: string) => string;
}

export const DISK_FLOOR: Readonly<Record<Lang, DiskFloorWords>> = {
  ru: {
    refused: (path, free, total, pct, floor, move) =>
      `на томе ${path} свободно ${free} ГБ из ${total} (${pct}%) — ниже пола ${floor}%: ${move}. Сначала убери своё: target/ и node_modules своих слитых деревьев, git worktree remove слитых; чужое не трогай. Затем повтори.`,
    moveRaise: () => "подъём агента не запущен",
    moveSubagent: () => "субагент не запущен",
    moveBuild: (command) => `сборка «${command}» не запущена`,
  },
  en: {
    refused: (path, free, total, pct, floor, move) =>
      `the volume of ${path} has ${free} GB free of ${total} (${pct}%) — below the ${floor}% floor: ${move}. First clear your own: target/ and node_modules of your merged trees, git worktree remove the merged ones; leave others' alone. Then retry.`,
    moveRaise: () => "the agent was not raised",
    moveSubagent: () => "the subagent was not started",
    moveBuild: (command) => `the build «${command}» was not started`,
  },
};
