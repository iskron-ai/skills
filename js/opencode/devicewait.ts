// Код входа с другого устройства (граф nks-dev: #6570) живёт минуты, а
// рукопожатие ждёт гранта дольше. Мост выпускает новый код в двух случаях:
// старый истёк — и он переписывает запись входа (`<хранилище>.auth-pending`);
// вызов застал меньше минуты — и код ложится рядом (`….auth-pending.device`).
// Плагин спрашивает мост снова, когда сменилось одно из двух или код доживает
// последнюю минуту: ответ на вопрос и есть свежий код.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Код, которому осталось меньше этого, человеку уже не годится — мост выпустит новый. */
const RENEW_BEFORE_MS = 60_000;

const UNTIL = /valid until (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) UTC/;

/**
 * Страница входа с кодом и конец её срока — как мост назвал их в отказе; нет
 * её, потому что на сервере нет клиента входа по коду, — слово моста, почему.
 */
export function deviceOf(message: string): string | null {
  const link = /from another device: (\S+)/.exec(message)?.[1];
  if (!link) return /no sign-in by code: (.+?) — or give the bridge/.exec(message)?.[1] ?? null;
  const until = UNTIL.exec(message)?.[1];
  return until ? `${link} (код действует до ${until} UTC)` : link;
}

/** Отпечаток записи входа и кода рядом; null — записи нет, вход кончился. */
function loginStamp(dir: string): string | null {
  try {
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".auth-pending") || f.endsWith(".auth-pending.device"),
    );
    if (!files.some((f) => f.endsWith(".auth-pending"))) return null;
    return files
      .map((f) => `${f}:${statSync(join(dir, f)).mtimeMs}`)
      .sort()
      .join("|");
  } catch {
    return null;
  }
}

/**
 * Сторож кода одного отказа. Запись пропала — вход кончился, и вопрос открыл
 * бы новый: тогда ждать гранта, как прежде.
 */
export function codeWatch(dir: string, message: string): { moved: () => boolean } {
  const before = loginStamp(dir);
  const until = UNTIL.exec(message)?.[1];
  const end = until ? Date.parse(`${until.replace(" ", "T")}Z`) : NaN;
  return {
    moved: () => {
      const now = loginStamp(dir);
      if (now !== null && now !== before) return true;
      return now !== null && end - Date.now() < RENEW_BEFORE_MS;
    },
  };
}
