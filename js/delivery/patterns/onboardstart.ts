// Живая русская форма realm list, 2026-10-17: js/tests/realm-list-live.txt (имена заменены).
export const REALM_LIST_HEADER = /^Доступные графы \((\d+)\)(?: —[^\n]*)?\r?$/m;
export const REALM_LIST_GROUP =
  /^▸ @([A-Za-z0-9_.-]+) \((?:(?<organization>организация)|пользователь)\)$/;
