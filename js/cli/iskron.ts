// Один исполняемый файл поставки iskron на все три процесса и диагностику:
//
//   node iskron.mjs [bridge] [server-url] [flags]   мост stdio↔https (по умолчанию)
//   node iskron.mjs watchdog [ключ] [--auth-dir <dir>]        сторож сокета под наблюдателем харнеса
//   node iskron.mjs watchdog-exit [ключ] [--auth-dir <dir>]   сторож выхода-на-кадре
//   node iskron.mjs watchdog-codex [ключ] [--auth-dir <dir>]  сторож Codex: кадр в идущий тред через app-server
//   node iskron.mjs doctor [server-url] [flags]     какая сборка стоит и работает ли она
//   node iskron.mjs update [--auth-dir <dir>]       свежий релиз в дом: мост, плагин OpenCode, SETUP.md
//   node iskron.mjs --version                       сборка vX.Y.Z+хеш
//
// Каждый долгоживущий запуск (мост, сторожа) сперва выравнивает дом: своя
// сборка новее домашней — ложится в дом; домашняя новее — запускается она
// (js/bridge/update.ts). Так свежая копия побеждает, каким бы файлом ни
// запустил харнес.
//
// Подкоманда без аргументов и всё, что не подкоманда, — мост: так запись в
// конфиге харнеса `node ~/.iskron-bridge/iskron-bridge.mjs` остаётся верной,
// каким бы именем ни лежала копия.
import { BUILD } from "../bridge/build.ts";
import { bridgeMain } from "../bridge/main.ts";
import { reexec, syncHome, updatesDisabled } from "../bridge/update.ts";
import { runWatchdogCodex } from "../watchdog/codex.ts";
import { runWatchdog } from "../watchdog/watchdog.ts";
import { runWatchdogExit } from "../watchdog/watchdog-exit.ts";
import { runDoctor } from "./doctor.ts";
import { runUpdate } from "./update.ts";

const USAGE = `iskron ${BUILD}
  node iskron.mjs [bridge] [server-url] [--timeout <ms>] [--auth-dir <dir>] [--no-browser] [--debug]
  node iskron.mjs watchdog [ключ] [--auth-dir <dir>]
  node iskron.mjs watchdog-exit [ключ] [--auth-dir <dir>]
  node iskron.mjs watchdog-codex [ключ] [--auth-dir <dir>]   (из оболочки Codex: CODEX_THREAD_ID, CODEX_HOME)
  node iskron.mjs doctor [server-url] [--auth-dir <dir>]
  node iskron.mjs update [--auth-dir <dir>]
  node iskron.mjs --version
  env: ISKRON_BRIDGE_TOKEN — личный токен вместо OAuth (или файл <auth-dir>/token);
       ISKRON_BRIDGE_URL, ISKRON_BRIDGE_AUTH_DIR, ISKRON_BRIDGE_NO_BROWSER, ISKRON_BRIDGE_DEBUG
`;

const argv = process.argv.slice(2);
const [first, ...rest] = argv;

// Дом против себя — только у долгоживущих: мост и сторожа. doctor и update
// говорят о том файле, который запустили; --version и --help чисты.
const LONG_LIVED = new Set([undefined, "bridge", "watchdog", "watchdog-exit", "watchdog-codex"]);
const longLived =
  LONG_LIVED.has(first) ||
  (first !== undefined && !first.startsWith("--") && !["doctor", "update", "-h"].includes(first));
if (longLived && !updatesDisabled() && !process.env.ISKRON_BRIDGE_REEXEC) {
  const sync = syncHome();
  for (const p of sync.copied)
    process.stderr.write(`[iskron-bridge] дом обновлён этой сборкой: ${p}\n`);
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
    case "bridge":
      bridgeMain(rest);
      break;
    case "--version":
      process.stdout.write(BUILD + "\n");
      break;
    case "--help":
    case "-h":
      process.stdout.write(USAGE);
      break;
    default:
      bridgeMain(argv);
  }
}
