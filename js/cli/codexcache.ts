// Копии плагина iskron в кэше Codex: `<дом>/plugins/cache/<рынок>/<плагин>/`, у
// других плагинов на машине — с уровнем версии ниже (`…/<плагин>/<версия>/`).
// Раскладка самого iskron с версией не наблюдалась — читаются обе.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface CodexCopy {
  market: string;
  plugin: string;
  dir: string;
}

const list = (d: string): string[] => {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
};

const isCopy = (d: string): boolean => existsSync(join(d, ".codex-plugin", "plugin.json"));

export function codexCopies(home: string): CodexCopy[] {
  const cache = join(home, "plugins", "cache");
  const out: CodexCopy[] = [];
  for (const market of list(cache))
    for (const plugin of list(join(cache, market))) {
      if (!/iskron/.test(plugin)) continue;
      const dir = join(cache, market, plugin);
      const versions = isCopy(dir) ? [] : list(dir).filter((v) => isCopy(join(dir, v)));
      if (!versions.length) out.push({ market, plugin, dir });
      for (const v of versions) out.push({ market, plugin, dir: join(dir, v) });
    }
  return out;
}
