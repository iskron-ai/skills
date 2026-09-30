// Какой iskron_stand мост исполняет одной занятостью (граф nks-dev: #6509) —
// одна правда для моста (bridge/status.ts) и плагина OpenCode
// (opencode/satellite.ts): вызов со status и только этими аргументами. Всякий
// другой заданный аргумент (model, room, room_karta, take, …) — занятие места.

/** Аргументы вызова одной занятости; satellite_of и cwd подставляет плагин OpenCode сам. */
export const STATUS_ONLY_ARGS: ReadonlySet<string> = new Set([
  "realm",
  "karta",
  "name",
  "cwd",
  "status",
  "satellite_of",
]);

const unset = (v: unknown): boolean => v == null || v === false || v === "";

/** Заданные аргументы вызова вне списка одной занятости — они ведут полный путь занятия. */
export const takingArgs = (args: Record<string, unknown>): string[] =>
  Object.keys(args).filter((k) => !STATUS_ONLY_ARGS.has(k) && !unset(args[k]));
