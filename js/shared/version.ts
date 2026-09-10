// Версия поставки — ОДНО число на всё: скиллы, мост, сторожа, расширение.
// Штампует release-please при мерже релизного PR (аннотация ниже); руками не
// трогать. Между релизами сборку различает хеш собственных байт файла, из
// которого её спрашивают, — он называет байты, которые реально бежали, включая
// правленные копии и забытые пересборки.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const VERSION = "6.6.3"; // x-release-please-version

/** Строка сборки `vX.Y.Z+хеш` для файла, чей `import.meta.url` передан. */
export function buildOf(selfUrl: string): string {
  try {
    const src = readFileSync(fileURLToPath(selfUrl));
    return `v${VERSION}+${createHash("sha256").update(src).digest("hex").slice(0, 8)}`;
  } catch {
    return `v${VERSION}`;
  }
}

/** Версия, объявленная в тексте другой копии, — читается строкой, без запуска. */
export function versionIn(text: string): string | null {
  const m = /^(?:const|let|var)\s+VERSION\s*=\s*"([^"]+)"/m.exec(text);
  return m ? m[1] : null;
}
