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
//                  ISKRON_BRIDGE_CLIENT_ID,
//                  ISKRON_BRIDGE_TOKEN (a personal access token: no OAuth at all; the
//                  file <auth-dir>/token is read when the variable is absent)
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
import { sleep, storePath } from "./store.ts";
import { debug, flushStdout, guardStream, log } from "./streams.ts";
import { type JsonRpcMessage } from "./types.ts";
import { startFreshnessWatch } from "./update.ts";

/** How long a bridge left by its harness still waits for a pending login's click. */
const ORPHAN_FLOW_MS = Number(process.env.ISKRON_BRIDGE_ORPHAN_FLOW_MS) || 5 * 60_000;

// Прокси корпоративной сети: Bun читает HTTP(S)_PROXY сам, Node — только с
// 24.5 и под NODE_USE_ENV_PROXY=1 (граф nks-dev: #4717, развилка для Node 22 —
// #4718). Идти мимо заданного прокси молча — значит упираться в сетевой отказ
// без причины, поэтому мост говорит рычаг на старте.
export function proxyWord(): string | null {
  const env = process.env;
  const proxy = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (!proxy || process.versions.bun) return null;
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  const reads = major > 24 || (major === 24 && minor >= 5);
  const on = env.NODE_USE_ENV_PROXY === "1" || process.execArgv.includes("--use-env-proxy");
  if (reads && on) return null;
  return reads
    ? "a proxy is set (HTTP(S)_PROXY), but Node reads it only under NODE_USE_ENV_PROXY=1 — " +
        "add that variable to the bridge's env in the harness config; until then calls go around the proxy"
    : `a proxy is set (HTTP(S)_PROXY), but Node ${process.versions.node} does not read it at all — ` +
        "Node 24.5+ with NODE_USE_ENV_PROXY=1 or the Bun runtime does; until then calls go around the proxy";
}

export function bridgeMain(argv: string[]): void {
  guardStream(process.stdout); // before the first write: a broken pipe is news, not a crash
  guardStream(process.stderr);
  setConfig(parseArgs(argv));
  installAuthLockExitHook();
  installRefreshLockExitHook();
  log(
    `${BUILD} -> ${CFG.serverUrl} (timeout ${CFG.timeoutMs}ms, ${
      CFG.pat ? `personal access token from ${CFG.patSource}` : `auth in ${storePath()}`
    })`,
  );
  const proxy = proxyWord();
  if (proxy) log(proxy);
  startTokenKeepalive();
  startFreshnessWatch(CFG.authDir, CFG.serverUrl); // отставание поставки — слово моста, не память человека
  holdFromEnv(); // отладочный путь: сокет из окружения, без connect

  const rl = createInterface({ input: process.stdin, terminal: false });
  const pending = new Set<Promise<void>>();
  let handshake: Promise<void> | null = null;
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
    // Конвейерный клиент (скрипт, сторож, отправитель из оболочки) шлёт
    // initialized и первый вызов, не дождавшись ответа на initialize; сервер без
    // Mcp-Session-Id отвечает 400 (граф nks-dev: #4308). Настоящие клиенты ждут —
    // мост ждёт за тех, кто не ждёт: всё, что пришло, пока рукопожатие в полёте,
    // уходит после него, в порядке прихода.
    const run = () =>
      deliver(msg).catch((e) => log(`unexpected: ${(e as Error)?.stack || errorMessage(e)}`));
    let p: Promise<void>;
    if (msg.method === "initialize") {
      p = run();
      handshake = p;
      p.finally(() => {
        if (handshake === p) handshake = null;
      });
    } else if (handshake) {
      const gate = handshake;
      p = gate.then(run, run);
    } else p = run();
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
      // The login has no deadline while a harness holds us; once it is gone,
      // the click is waited for only so long — nothing is left hanging forever.
      log(
        `${why}, but an authorization flow is pending — staying up for the human's click, ` +
          `at most ${Math.round(ORPHAN_FLOW_MS / 1000)}s`,
      );
      await Promise.race([flow.catch(() => {}), sleep(ORPHAN_FLOW_MS)]);
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
    releaseStanding("SIGINT"); // иначе .key переживает мост и уводит сторожа без ключа на мёртвый сокет
    if (interrupted || tokenRequestsInFlight.size === 0) process.exit(0);
    interrupted = true;
    Promise.allSettled([...tokenRequestsInFlight]).then(() => process.exit(0));
  });
  process.on("uncaughtException", (e) => log(`uncaught: ${e?.stack || e}`));
  process.on("unhandledRejection", (e) =>
    log(`unhandled rejection: ${(e as Error)?.stack || String(e)}`),
  );
}
