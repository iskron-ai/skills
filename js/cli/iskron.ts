// Один исполняемый файл поставки iskron на все три процесса и диагностику:
//
//   node iskron.mjs [bridge] [server-url] [flags]   мост stdio↔https (по умолчанию)
//   node iskron.mjs watchdog [wss://…]              сторож сокета под наблюдателем харнеса
//   node iskron.mjs watchdog-exit [wss://…]         сторож выхода-на-кадре
//   node iskron.mjs doctor [server-url] [flags]     какая сборка стоит и работает ли она
//   node iskron.mjs --version                       сборка vX.Y.Z+хеш
//
// Подкоманда без аргументов и всё, что не подкоманда, — мост: так запись в
// конфиге харнеса `node ~/.iskron-bridge/iskron-bridge.mjs` остаётся верной,
// каким бы именем ни лежала копия.
import { BUILD } from "../bridge/build.ts";
import { bridgeMain } from "../bridge/main.ts";
import { runWatchdog } from "../watchdog/watchdog.ts";
import { runWatchdogExit } from "../watchdog/watchdog-exit.ts";
import { runDoctor } from "./doctor.ts";

const USAGE = `iskron ${BUILD}
  node iskron.mjs [bridge] [server-url] [--timeout <ms>] [--auth-dir <dir>] [--no-browser] [--debug]
  node iskron.mjs watchdog [wss://…]
  node iskron.mjs watchdog-exit [wss://…]
  node iskron.mjs doctor [server-url] [--auth-dir <dir>]
  node iskron.mjs --version
`;

const argv = process.argv.slice(2);
const [first, ...rest] = argv;

switch (first) {
  case "watchdog":
    runWatchdog(rest);
    break;
  case "watchdog-exit":
    runWatchdogExit(rest);
    break;
  case "doctor":
    void runDoctor(rest);
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
