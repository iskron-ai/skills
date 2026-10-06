// Код входа с другого устройства (граф nks-dev: #6570) живёт минуты, а
// рукопожатие ждёт гранта дольше. Мост держит код до конца его срока и выпускает
// новый, только когда старый истёк: сам — и переписывает запись входа
// (`<хранилище>.auth-pending`), или по вызову — и код ложится рядом
// (`….auth-pending.device`). Плагин спрашивает мост снова, когда сменилось одно
// из двух или срок кода прошёл: ответ на вопрос и есть свежий код.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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
      return now !== null && end <= Date.now();
    },
  };
}
