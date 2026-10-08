// One executable for the bridge, the watchdogs, the daemon and diagnostics;
// subcommands are listed by --help. No subcommand, or anything that is not one,
// runs the bridge, so a harness config entry stays valid whatever the copy is named.
import { BUILD } from "../bridge/build.ts";
import { daemonMain } from "../bridge/daemon.ts";
import { bridgeMain } from "../bridge/main.ts";
import { versionLines } from "../bridge/probe.ts";
import { reexec, syncHome, updatesDisabled } from "../bridge/update.ts";
import { L } from "../shared/lang.ts";
import { runWatchdogCodex } from "../watchdog/codex.ts";
import { runWatchdog } from "../watchdog/watchdog.ts";
import { runWatchdogExit } from "../watchdog/watchdog-exit.ts";
import { runDoctor } from "./doctor.ts";
import { RITUALS_USAGE, runCheckRituals } from "./rituals.ts";
import { runUpdate } from "./update.ts";
import { runUse } from "./use.ts";

const usage = (): string => `iskron ${BUILD}
  node iskron.mjs [bridge] [server-url] [--timeout <ms>] [--auth-dir <dir>] [--no-browser] [--debug] [--satellite] [--tools <a,b,c>]
      ${L("(--satellite — мост прогона субагента из файла агента: только место-спутник <место позвавшего>.sub-N)", "(--satellite — the bridge of a subagent run from an agent file: only the satellite seat <caller's seat>.sub-N)")}
      ${L("(--tools — какие тулы видит харнес, iskron_stand всегда; без флага — все)", "(--tools — which tools the harness sees, iskron_stand always; without the flag — all)")}
  node iskron.mjs watchdog [${L("ключ", "key")}] [--auth-dir <dir>] [--lang en|ru]
  node iskron.mjs watchdog-exit [${L("ключ", "key")}] [--auth-dir <dir>] [--lang en|ru]
  node iskron.mjs watchdog-codex [${L("ключ", "key")}] [--auth-dir <dir>] [--lang en|ru]   ${L("(из оболочки Codex: CODEX_THREAD_ID, CODEX_HOME)", "(from the Codex shell: CODEX_THREAD_ID, CODEX_HOME)")}
      ${L("(--lang — язык поверхности; команду сторожа с ним печатает блок моста)", "(--lang — the surface language; the bridge block prints the watchdog command with it)")}
  node iskron.mjs doctor [server-url] [--auth-dir <dir>]
  node iskron.mjs update [--auth-dir <dir>]
  node iskron.mjs use <en|ru|url> [--auth-dir <dir>]   ${L("(en — mcp.iskron.ai, ru — mcp.iskron.ru)", "(en — mcp.iskron.ai, ru — mcp.iskron.ru)")}
  ${RITUALS_USAGE()}
  node iskron.mjs daemon --auth-dir <dir>   ${L("(демон машины; его поднимает тонкий мост — мост по умолчанию)", "(the machine daemon; the thin bridge raises it — the default bridge)")}
  node iskron.mjs version   ${L("(или --version)", "(or --version)")}
  env: ISKRON_BRIDGE_TOKEN — ${L("личный токен вместо OAuth (или файл <auth-dir>/token)", "a personal token instead of OAuth (or the file <auth-dir>/token)")};
       ISKRON_BRIDGE_DAEMON=0 — ${L("полный мост в своём процессе, без демона машины", "the full bridge in its own process, without the machine daemon")};
       ISKRON_BRIDGE_URL, ISKRON_BRIDGE_AUTH_DIR, ISKRON_BRIDGE_NO_BROWSER, ISKRON_BRIDGE_DEBUG
`;

const argv = process.argv.slice(2);
const [first, ...rest] = argv;

// Only long-lived runs (bridge, watchdogs) align the home copy first (bridge/update.ts):
// doctor and update speak of the file that was launched, and the daemon aligns itself,
// rising as a successor rather than a wrapper.
const LONG_LIVED = new Set([undefined, "bridge", "watchdog", "watchdog-exit", "watchdog-codex"]);
const longLived =
  LONG_LIVED.has(first) ||
  (first !== undefined &&
    !first.startsWith("--") &&
    !["doctor", "update", "use", "check-rituals", "daemon", "version", "-h"].includes(first));
if (longLived && !updatesDisabled() && !process.env.ISKRON_BRIDGE_REEXEC) {
  const sync = syncHome();
  for (const p of sync.copied)
    process.stderr.write(
      `[iskron-bridge] ${L("дом обновлён этой сборкой", "home updated by this build")}: ${p}\n`,
    );
  if (sync.reexec) reexec(sync.reexec, argv);
  else dispatch();
} else dispatch();

function dispatch(): void {
  switch (first) {
    case "watchdog":
      runWatchdog(rest);
      break;
    case "watchdog-exit":
      runWatchdogExit(rest);
      break;
    case "watchdog-codex":
      runWatchdogCodex(rest);
      break;
    case "doctor":
      void runDoctor(rest);
      break;
    case "update":
      void runUpdate(rest);
      break;
    case "use":
      runUse(rest);
      break;
    case "check-rituals":
      void runCheckRituals(rest);
      break;
    case "bridge":
      bridgeMain(rest);
      break;
    case "daemon":
      void daemonMain(rest);
      break;
    case "--version":
    case "version":
      // With the thin bridge (the default) the daemon's build follows on a second line.
      void versionLines(rest).then((lines) => process.stdout.write(lines.join("\n") + "\n"));
      break;
    case "--help":
    case "-h":
      process.stdout.write(usage());
      break;
    default:
      bridgeMain(argv);
  }
}
