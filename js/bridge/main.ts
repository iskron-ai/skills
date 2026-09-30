// iskron-bridge — stdio <-> streamable-HTTP MCP bridge with the full OAuth 2.1 flow.
//
// For harnesses that cannot (or should not) speak https+OAuth MCP themselves:
// the harness runs this file as an ordinary stdio MCP server, and the bridge
// carries every JSON-RPC message to a remote streamable-HTTP MCP server,
// handling discovery (RFC 9728 / RFC 8414), dynamic client registration,
// authorization-code + PKCE in the browser, token persistence and refresh.
//
// The design rule that justifies this bridge's existence: NEVER answer the
// harness with silence. Every forwarded request gets a deadline; any upstream
// failure — timeout, dead TCP, HTTP error, lost session — comes back to the
// harness as a JSON-RPC error for that request id. There are no long-lived
// upstream connections to go half-dead: each request is its own POST.
//
// Usage:
//   node iskron.mjs [bridge] [server-url] [--timeout <ms>] [--auth-dir <dir>]
//                   [--client-name <name>] [--no-browser] [--debug] [--satellite]
// --satellite: the bridge of a subagent run — see satellite.ts (a flag only, no env: an older bridge must fail loudly).
// With no server-url the bridge points at the product instance (DEFAULT_SERVER_URL);
// pass a URL (or set ISKRON_BRIDGE_URL) only for another instance or fork.
// Env (flags win): ISKRON_BRIDGE_URL, ISKRON_BRIDGE_TIMEOUT, ISKRON_BRIDGE_AUTH_DIR,
//                  ISKRON_BRIDGE_NO_BROWSER, ISKRON_BRIDGE_DEBUG, ISKRON_BRIDGE_SCOPE,
//                  ISKRON_BRIDGE_RESOURCE (override the resource indicator / audience),
//                  ISKRON_BRIDGE_CLIENT_ID,
//                  ISKRON_BRIDGE_TOKEN (a personal access token: no OAuth at all; the
//                  file <auth-dir>/token is read when the variable is absent),
//                  ISKRON_BRIDGE_DAEMON=1 (тонкий мост к демону машины, thin.ts; по
//                  умолчанию выключено), ISKRON_BRIDGE_NO_DAEMON=1 (полный мост всегда)
//
// No dependencies. Node >= 22.
import { parseArgs } from "./config.ts";
import { fullBridgeSigint, installCrashWords, startEngine } from "./engine.ts";
import { openSession } from "./session.ts";
import { guardStream } from "./streams.ts";
import { daemonWanted, thinMain } from "./thin.ts";

export function bridgeMain(argv: string[]): void {
  guardStream(process.stdout); // before the first write: a broken pipe is news, not a crash
  guardStream(process.stderr);
  if (daemonWanted()) {
    thinMain(argv);
    return;
  }
  startEngine(parseArgs(argv));
  const session = openSession({ input: process.stdin, output: process.stdout });
  void session.ended.then(() => process.exit(0));
  process.on("SIGTERM", () => void session.leave("SIGTERM"));
  process.on("SIGINT", fullBridgeSigint());
  installCrashWords();
}
