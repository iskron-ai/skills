// Проза сервера, по которой поставка подаёт срез правил человека из mind (ядро shared/mindslice.ts,
// граф @nks/nks-dev, узлы #9817, #9816). Наблюдено 07.11.2026 по-русски: признак readiness
// «  personal_mind «Личная память» — present · scope: person · ready: да» (отсутствие — `missing`);
// строка выдачи iskron_search «  🔛 Имя (#65, phenomenon, Pt/Va/Ad, v2) — фрагмент…» под шапкой
// «Найдено N узлов:», хвост «↳ Выбери один узел…» строкой не считается. Группы строки: имя,
// номер, фрагмент описания (его может не быть).
export const MIND_PRESENT = /^\s*personal_mind\b[^\n]*—\s*present\b/m;
export const MIND_MISSING = /^\s*personal_mind\b[^\n]*—\s*missing\b/m;
export const MIND_ROW = /^\s+(\S[^\n]*?) \(#(\d+), [^\s,)]+[^)\n]*\)(?: — ([^\n]*))?$/;
