// update — свежий релиз в дом по требованию: мост (в ~/.iskron-bridge),
// плагин OpenCode (если стоит), SETUP.md рядом — и отчёт, что делать дальше.
// Скиллы этот файл не обновляет: их кладёт канал харнеса, порядок — в свежем
// SETUP.md, который здесь и скачивается для агента.
import { BUILD } from "../bridge/build.ts";
import { parseArgs, setConfig } from "../bridge/config.ts";
import { CFG } from "../bridge/config.ts";
import { checkLatest, setupPathOf } from "../bridge/update.ts";
import { homeBridgePath } from "../shared/home.ts";
import { L } from "../shared/lang.ts";
import { compareVersions } from "../shared/semver.ts";
import { VERSION } from "../shared/version.ts";
import { freshnessWord, harnessReport, serverSourceWord } from "./doctor.ts";

const out = (s: string): void => {
  process.stdout.write(s + "\n");
};

export async function runUpdate(argv: string[]): Promise<void> {
  setConfig(parseArgs(argv));
  out(`iskron update — ${BUILD}`);
  out(
    L(
      `сервер: ${CFG.serverUrl} (${serverSourceWord()}) — ${freshnessWord(CFG.serverUrl)}`,
      `server: ${CFG.serverUrl} (${serverSourceWord()}) — ${freshnessWord(CFG.serverUrl)}`,
    ),
  );
  const latest = await checkLatest(CFG.authDir, true);
  if (!latest || !latest.version) {
    out(
      latest?.rate_limited
        ? L(
            `свежий релиз не узнан: ${latest.error} — лимит GitHub; повтори ${latest.rate_limited_until ? "после сброса" : "позже"}`,
            `latest release unknown: ${latest.error} — GitHub rate limit; retry ${latest.rate_limited_until ? "after the reset" : "later"}`,
          )
        : L(
            `свежий релиз не узнан: ${latest?.error ?? "нет ответа"} — сеть или GitHub; повтори позже`,
            `latest release unknown: ${latest?.error ?? "no answer"} — network or GitHub; retry later`,
          ),
    );
    process.exitCode = 1;
    return;
  }
  const cmp = compareVersions(latest.version, VERSION);
  const behind =
    cmp > 0
      ? L(" — отстал", " — behind")
      : cmp < 0
        ? L(" — новее релиза (сборка из ветки)", " — newer than the release (a branch build)")
        : L(" — не отстал", " — not behind");
  out(
    L(
      `свежий релиз: v${latest.version} (${latest.tag}); этот файл: v${VERSION}${behind}`,
      `latest release: v${latest.version} (${latest.tag}); this file: v${VERSION}${behind}`,
    ),
  );
  if (latest.error) out(L(`скачать не вышло: ${latest.error}`, `download failed: ${latest.error}`));
  if (latest.downloaded.length)
    for (const p of latest.downloaded) out(L(`положено: ${p}`, `placed: ${p}`));
  else
    out(
      L(
        `в дом ничего не клалось: ${homeBridgePath()} не старше релиза`,
        `nothing was placed in the home: ${homeBridgePath()} is not older than the release`,
      ),
    );
  harnessReport();
  out("");
  out(L("Дальше:", "Next:"));
  const setup = setupPathOf(CFG.authDir);
  const fetched = latest.downloaded.includes(setup);
  out(
    L(
      `  1. Скиллы обновляет канал харнеса — порядок в свежем установщике ${setup}${fetched ? "" : " (не скачан — возьми из релиза)"}: прочти его и исполни шаги обновления для этого харнеса.`,
      `  1. Skills are updated by the harness channel — the order is in the fresh installer ${setup}${fetched ? "" : " (not downloaded — take it from the release)"}: read it and carry out the update steps for this harness.`,
    ),
  );
  out(
    L(
      "  2. Перезапусти сессии харнеса: мост, поднятый прежней сборкой, живёт до конца своей сессии.",
      "  2. Restart the harness sessions: a bridge started by the previous build lives until the end of its session.",
    ),
  );
  out(
    L(
      "  3. node ~/.iskron-bridge/iskron-bridge.mjs doctor — сверка, что стоит и работает.",
      "  3. node ~/.iskron-bridge/iskron-bridge.mjs doctor — a check of what is installed and working.",
    ),
  );
}
