// Версия поставки — ОДНО число на всё: скиллы, мост, сторожа, расширение.
// Штампует release-please при мерже релизного PR (аннотация ниже); руками не
// трогать. Между релизами сборку различает хеш собственных байт файла, из
// которого её спрашивают, — он называет байты, которые реально бежали, включая
// правленные копии и забытые пересборки.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const VERSION = "7.7.0"; // x-release-please-version

/**
 * Метка канала сборки (#6650): ":release" вшивает только сборка выпуска (js/build.mjs под
 * ISKRON_BUILD_CHANNEL=release — джоб bundle-sync релизного PR); всякая иная сборка — ":dev".
 * Строка, не флаг: сборка заменяет её в выходе буквально.
 */
const CHANNEL_MARK: string = "iskron-build:dev";
/** Эта сборка — выпуск: только ей дом машины верит как новому мосту. */
export const releaseBuild = (): boolean => CHANNEL_MARK.endsWith(":release");
/** Текст другой копии — сборка выпуска. Метка собрана по частям: в выходе её буквы стоят только у выпуска. */
export const releaseBuildIn = (text: string): boolean =>
  text.includes(`"${["iskron-build", "release"].join(":")}"`);
/** Текст другой копии — явно dev-сборка. Копия без метки (выпуски до 7.2.8) — ни то ни другое. */
export const devBuildIn = (text: string): boolean =>
  text.includes(`"${["iskron-build", "dev"].join(":")}"`);

/** Строка сборки `vX.Y.Z+хеш` для файла, чей `import.meta.url` передан. */
export function buildOf(selfUrl: string): string {
  try {
    const src = readFileSync(fileURLToPath(selfUrl));
    return `v${VERSION}+${createHash("sha256").update(src).digest("hex").slice(0, 8)}`;
  } catch {
    return `v${VERSION}`;
  }
}

/** Строка сборки другой копии по её файлу: версия из её текста, хеш по её байтам; null — файл не читается. */
export function buildOfFile(path: string): string | null {
  try {
    const src = readFileSync(path);
    const v = versionIn(src.toString("utf8")) ?? "?";
    return `v${v}+${createHash("sha256").update(src).digest("hex").slice(0, 8)}`;
  } catch {
    return null;
  }
}

/** Версия, объявленная в тексте другой копии, — читается строкой, без запуска. */
export function versionIn(text: string): string | null {
  const m = /^(?:const|let|var)\s+VERSION\s*=\s*"([^"]+)"/m.exec(text);
  return m ? m[1] : null;
}
