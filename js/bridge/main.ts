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
//                   [--client-name <name>] [--no-browser] [--debug]
// With no server-url the bridge points at the product instance (DEFAULT_SERVER_URL);
// pass a URL (or set ISKRON_BRIDGE_URL) only for another instance or fork.
// Env (flags win): ISKRON_BRIDGE_URL, ISKRON_BRIDGE_TIMEOUT, ISKRON_BRIDGE_AUTH_DIR,
//                  ISKRON_BRIDGE_NO_BROWSER, ISKRON_BRIDGE_DEBUG, ISKRON_BRIDGE_SCOPE,
//                  ISKRON_BRIDGE_RESOURCE (override the resource indicator / audience),
//                  ISKRON_BRIDGE_CLIENT_ID
//
// No dependencies. Node >= 22.
import { createInterface } from "node:readline";

import { startTokenKeepalive } from "./auth.ts";
import { BUILD } from "./build.ts";
import { CFG, parseArgs, setConfig } from "./config.ts";
import { deliver } from "./deliver.ts";
import { errorMessage } from "./errors.ts";
import { holdFromEnv, releaseStanding } from "./hold.ts";
import { installAuthLockExitHook } from "./oauth/authlock.ts";
import { pendingFlow } from "./oauth/flow.ts";
import { installRefreshLockExitHook } from "./oauth/refreshlock.ts";
import { tokenRequestsInFlight } from "./oauth/tokenrequest.ts";
import { storePath } from "./store.ts";
import { debug, flushStdout, guardStream, log } from "./streams.ts";
import { type JsonRpcMessage } from "./types.ts";

export function bridgeMain(argv: string[]): void {
  guardStream(process.stdout); // before the first write: a broken pipe is news, not a crash
  guardStream(process.stderr);
  setConfig(parseArgs(argv));
  installAuthLockExitHook();
  installRefreshLockExitHook();
  log(`${BUILD} -> ${CFG.serverUrl} (timeout ${CFG.timeoutMs}ms, auth in ${storePath()})`);
  startTokenKeepalive();
  holdFromEnv(); // отладочный путь: сокет из окружения, без connect

  const rl = createInterface({ input: process.stdin, terminal: false });
  const pending = new Set<Promise<void>>();
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      log(`unparseable line from harness: ${trimmed.slice(0, 120)}`);
      return;
    }
    const p = deliver(msg).catch((e) =>
      log(`unexpected: ${(e as Error)?.stack || errorMessage(e)}`),
    );
    pending.add(p);
    p.finally(() => pending.delete(p));
  });
  // A human may be mid-click on OUR authorize URL: dying now kills the callback
  // server and silently loses their login, and the click is not repeatable —
  // the human sees a browser error, not a retry. So a bridge asked to go away
  // outlives a pending flow, and a token rotation already in flight must land
  // on disk before exit; each request's own timeout bounds the wait. A harness
  // that will not wait that long may kill us outright. That is survivable for
  // the browser flow: the next bridge finds no listener on the callback port
  // and takes the flow over. It is NOT survivable for an in-flight rotation:
  // the killed bridge leaves the machine holding a retired refresh token. That
  // is the price SIGKILL always pays; SIGTERM, stdin-close, and SIGINT no longer do.
  const leave = async (why: string) => {
    debug(`${why} — winding down`);
    releaseStanding(why); // сокет стояния живёт ровно столько, сколько сессия
    await Promise.allSettled([...pending, ...tokenRequestsInFlight]);
    await flushStdout(); // an answer half-written is an answer not given
    const flow = pendingFlow();
    if (flow) {
      log(
        `${why}, but an authorization flow is pending — staying up until the human's click lands`,
      );
      await flow.catch(() => {});
    }
    await Promise.allSettled([...tokenRequestsInFlight]); // a tick may have started one while we waited
    await flushStdout();
    process.exit(0);
  };
  rl.on("close", () => void leave("stdin closed, the harness is gone"));
  process.on("SIGTERM", () => void leave("SIGTERM"));
  // Ctrl-C is the one exception — someone is at the terminal, wanting out. Even
  // so, a rotation already in flight is written down first: the wait is bounded
  // by the request's own deadline and is usually well under a second, while
  // leaving without it costs the whole machine its grant (graph @nks/nks-dev,
  // node #4170). A second Ctrl-C leaves at once — the human has said it twice.
  let interrupted = false;
  process.on("SIGINT", () => {
    if (interrupted || tokenRequestsInFlight.size === 0) process.exit(0);
    interrupted = true;
    Promise.allSettled([...tokenRequestsInFlight]).then(() => process.exit(0));
  });
  process.on("uncaughtException", (e) => log(`uncaught: ${e?.stack || e}`));
  process.on("unhandledRejection", (e) =>
    log(`unhandled rejection: ${(e as Error)?.stack || String(e)}`),
  );
}
