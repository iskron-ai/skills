// Процессная часть движка моста — то, что живёт одно на процесс, а не на
// сессию: конфиг процесса, замки гранта на выходе, бодрствование токена, сверка
// поставки с релизами. Полный мост зовёт её перед своей единственной сессией
// (main.ts); тонкий мост — только когда идёт полным мостом в процессе (thin.ts);
// демон машины — раз на свои многие сессии (daemon.ts).
import { startTokenKeepalive } from "./auth.ts";
import { BUILD } from "./build.ts";
import { CFG, setConfig } from "./config.ts";
import { releaseStanding } from "./hold.ts";
import { statusAddress } from "./statusaddr.ts";
import { installAuthLockExitHook } from "./oauth/authlock.ts";
import { installRefreshLockExitHook } from "./oauth/refreshlock.ts";
import { tokenRequestsInFlight } from "./oauth/tokenrequest.ts";
import { publishStatusTo } from "./status.ts";
import { storePath } from "./store.ts";
import { log } from "./streams.ts";
import { type Config } from "./types.ts";
import { startFreshnessWatch } from "./update.ts";

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
  const flags = [...process.execArgv, ...(env.NODE_OPTIONS ?? "").split(/\s+/)]; // NODE_OPTIONS flags are not in execArgv
  const on = env.NODE_USE_ENV_PROXY === "1" || flags.includes("--use-env-proxy");
  if (reads && on) return null;
  return reads
    ? "a proxy is set (HTTP(S)_PROXY), but Node reads it only under NODE_USE_ENV_PROXY=1 — " +
        "add that variable to the bridge's env in the harness config; until then calls go around the proxy"
    : `a proxy is set (HTTP(S)_PROXY), but Node ${process.versions.node} does not read it at all — ` +
        "Node 24.5+ with NODE_USE_ENV_PROXY=1 or the Bun runtime does; until then calls go around the proxy";
}

/** Сбой без ловца — слово в stderr, не смерть процесса: харнес не должен остаться без ответа. */
export function installCrashWords(): void {
  process.on("uncaughtException", (e) => log(`uncaught: ${e?.stack || e}`));
  process.on("unhandledRejection", (e) =>
    log(`unhandled rejection: ${(e as Error)?.stack || String(e)}`),
  );
}

/**
 * Ctrl-C полного моста (и тонкого в полном ходе). Ctrl-C is the one exception —
 * someone is at the terminal, wanting out. Even so, a rotation already in flight
 * is written down first: the wait is bounded by the request's own deadline and
 * is usually well under a second, while leaving without it costs the whole
 * machine its grant (graph @nks/nks-dev, node #4170). A second Ctrl-C leaves at
 * once — the human has said it twice.
 * Спутник SIGINT'ом гасит харнес (Claude Code), не человек: первый идёт концом
 * прогона сессии (`leave` — выход из дел и снятие места, #6573, #6593).
 */
export function fullBridgeSigint(leave?: (why: string) => Promise<void>): () => void {
  let interrupted = false;
  return () => {
    if (CFG.satellite && leave && !interrupted) {
      interrupted = true;
      void leave("SIGINT");
      return;
    }
    const addr = statusAddress();
    releaseStanding("SIGINT"); // иначе .key переживает мост и уводит сторожа без ключа на мёртвый сокет
    if (interrupted) process.exit(0);
    interrupted = true;
    // Занятость снимается и здесь — коротко, второй Ctrl-C выходит сразу.
    const clearing = addr ? publishStatusTo(addr.url, "", 2000).catch(() => {}) : null;
    if (!clearing && tokenRequestsInFlight.size === 0) process.exit(0);
    Promise.allSettled([...tokenRequestsInFlight, ...(clearing ? [clearing] : [])]).then(() =>
      process.exit(0),
    );
  };
}

/**
 * Поднять процессную часть движка под этим конфигом. Один раз на процесс.
 * `freshness: false` — сверку с релизами ведёт хозяин сам (демон машины, daemon.ts).
 */
export function startEngine(cfg: Config, opts: { freshness?: boolean } = {}): void {
  setConfig(cfg);
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
  // отставание поставки — слово моста, не память человека
  if (opts.freshness !== false) startFreshnessWatch(CFG.authDir, CFG.serverUrl);
}
