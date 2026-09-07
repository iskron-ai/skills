import { homedir } from "node:os";
import { join } from "node:path";

import { BUILD } from "./build.ts";
import { log } from "./streams.ts";
import { type Config } from "./types.ts";

export const DEFAULT_SERVER_URL = "https://mcp.iskron.ru/";

// Конфиг процесса — один на мост, выставляется в main() до первого вызова.
// Живая привязка ES-модуля: импортёры видят значение после setConfig.
export let CFG: Config = null as unknown as Config;

export function setConfig(cfg: Config): void {
  CFG = cfg;
}

export function parseArgs(argv: string[]): Config {
  const cfg: Config = {
    serverUrl: "",
    timeoutMs: Number(process.env.ISKRON_BRIDGE_TIMEOUT) || 120_000,
    authDir: process.env.ISKRON_BRIDGE_AUTH_DIR || join(homedir(), ".iskron-bridge"),
    clientName: "iskron-bridge",
    noBrowser: !!process.env.ISKRON_BRIDGE_NO_BROWSER,
    debug: !!process.env.ISKRON_BRIDGE_DEBUG,
    scope: process.env.ISKRON_BRIDGE_SCOPE || null,
    resource: process.env.ISKRON_BRIDGE_RESOURCE || null,
    staticClientId: process.env.ISKRON_BRIDGE_CLIENT_ID || null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--timeout") cfg.timeoutMs = Number(argv[++i]);
    else if (a === "--auth-dir") cfg.authDir = argv[++i];
    else if (a === "--client-name") cfg.clientName = argv[++i];
    else if (a === "--no-browser") cfg.noBrowser = true;
    else if (a === "--debug") cfg.debug = true;
    else if (a === "--version") {
      process.stdout.write(BUILD + "\n");
      process.exit(0);
    } else if (!a.startsWith("--") && !cfg.serverUrl) cfg.serverUrl = a;
    else {
      log(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (!cfg.serverUrl) cfg.serverUrl = process.env.ISKRON_BRIDGE_URL || DEFAULT_SERVER_URL;
  try {
    new URL(cfg.serverUrl);
  } catch {
    log(`not a URL: ${cfg.serverUrl}`);
    process.exit(2);
  }
  if (!Number.isFinite(cfg.timeoutMs) || cfg.timeoutMs < 1000) cfg.timeoutMs = 120_000;
  return cfg;
}
