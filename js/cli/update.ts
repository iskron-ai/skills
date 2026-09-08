// update — свежий релиз в дом по требованию: мост (в ~/.iskron-bridge),
// плагин OpenCode (если стоит), SETUP.md рядом — и отчёт, что делать дальше.
// Скиллы этот файл не обновляет: их кладёт канал харнеса, порядок — в свежем
// SETUP.md, который здесь и скачивается для агента.
import { BUILD } from "../bridge/build.ts";
import { parseArgs, setConfig } from "../bridge/config.ts";
import { CFG } from "../bridge/config.ts";
import { checkLatest, setupPathOf } from "../bridge/update.ts";
import { homeBridgePath } from "../shared/home.ts";
import { compareVersions } from "../shared/semver.ts";
import { VERSION } from "../shared/version.ts";
import { harnessReport } from "./doctor.ts";

const out = (s: string): void => {
  process.stdout.write(s + "\n");
};

export async function runUpdate(argv: string[]): Promise<void> {
  setConfig(parseArgs(argv));
  out(`iskron update — ${BUILD}`);
  const latest = await checkLatest(CFG.authDir, true);
  if (!latest || !latest.version) {
    out(`свежий релиз не узнан: ${latest?.error ?? "нет ответа"} — сеть или GitHub; повтори позже`);
    process.exitCode = 1;
    return;
  }
  const cmp = compareVersions(latest.version, VERSION);
  out(
    `свежий релиз: v${latest.version} (${latest.tag}); этот файл: v${VERSION}${cmp > 0 ? " — отстал" : cmp < 0 ? " — новее релиза (сборка из ветки)" : " — не отстал"}`,
  );
  if (latest.error) out(`скачать не вышло: ${latest.error}`);
  if (latest.downloaded.length) for (const p of latest.downloaded) out(`положено: ${p}`);
  else out(`в дом ничего не клалось: ${homeBridgePath()} не старше релиза`);
  harnessReport();
  out("");
  out("Дальше:");
  out(
    `  1. Скиллы обновляет канал харнеса — порядок в свежем установщике ${setupPathOf(CFG.authDir)}${latest.downloaded.includes(setupPathOf(CFG.authDir)) ? "" : " (не скачан — возьми из релиза)"}: прочти его и исполни шаги обновления для этого харнеса.`,
  );
  out(
    "  2. Перезапусти сессии харнеса: мост, поднятый прежней сборкой, живёт до конца своей сессии.",
  );
  out("  3. node ~/.iskron-bridge/iskron-bridge.mjs doctor — сверка, что стоит и работает.");
}
