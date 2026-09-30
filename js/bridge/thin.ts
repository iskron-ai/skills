// Тонкий мост — сторона агента на шве «тонкий мост ↔ демон машины» (провод —
// shared/seam.ts). Держит stdio харнеса и отдаёт всё демону своего каталога
// гранта: JSON-RPC как есть в обе стороны. Сам хранит только то, без чего обрыв
// стал бы молчанием: копию initialize харнеса и id вызовов в полёте.
//
//   демона нет      поднимает его отсоединённо (`iskron.mjs daemon`) под выборами
//                   по образцу refreshlock; не встал — полный мост в процессе, и
//                   мост говорит это: stderr и первый ответ тула
//   обрыв связи     каждый id в полёте — синтетическая ошибка с вердиктом («не
//                   отправлено» / «исход неизвестен»), затем переподхват по id
//                   локальной сессии; сессия новая — initialize переигрывается
//   конец           stdin закрыт, SIGTERM — bye демону с ограниченным ожиданием
//
// Шаг 1: за флагом ISKRON_BRIDGE_DAEMON=1 (по умолчанию полный мост, как было);
// ISKRON_BRIDGE_NO_DAEMON=1 — полный мост всегда.
import { spawn } from "node:child_process";
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  connectSeam,
  DAEMON_ENV,
  helloFrame,
  NO_DAEMON_ENV,
  SeamError,
  type SeamLink,
  seamRaiseLockPath,
  seamSocketPath,
} from "../shared/seam.ts";
import { defaultAuthDir } from "../shared/standings.ts";
import { BUILD } from "./build.ts";
import { parseArgs, setConfig } from "./config.ts";
import { syntheticError } from "./deliver.ts";
import { installCrashWords, startEngine } from "./engine.ts";
import { NOT_SENT, UNKNOWN } from "./errors.ts";
import { pidAlive } from "./oauth/authlock.ts";
import { type BridgeSession, openSession } from "./session.ts";
import { sleep } from "./store.ts";
import { debug, flushStdout, log, writeTo } from "./streams.ts";
import { type JsonRpcMessage } from "./types.ts";

const ms = (name: string, dflt: number): number => {
  const v = Number(process.env[name]);
  return process.env[name]?.trim() && Number.isFinite(v) && v >= 0 ? v : dflt;
};
/** Сколько ждать демона — своего или поднятого — прежде чем идти полным мостом. */
const ATTACH_MS = ms("ISKRON_BRIDGE_DAEMON_WAIT_MS", 5_000);
/** Сколько ждать bye-ok на уходе. */
const BYE_MS = ms("ISKRON_BRIDGE_BYE_MS", 5_000);
const HELLO_MS = 3_000;
const POLL_MS = 100;
/** Замок подъёма, чей хозяин жив, но держит его дольше, — брошен. */
const RAISE_STALE_MS = 15_000;

const SELF = (() => {
  try {
    return fileURLToPath(import.meta.url);
  } catch {
    return process.argv[1] ?? "";
  }
})();

/** Тонкий мост включён: флаг стоит, выключателя нет. */
export function daemonWanted(): boolean {
  const off = process.env[NO_DAEMON_ENV]?.trim();
  return process.env[DAEMON_ENV]?.trim() === "1" && (!off || off === "0");
}

// --- выборы подъёма ----------------------------------------------------------

interface RaiseLock {
  pid: number;
  started_at: number;
}

function takeRaiseLock(authDir: string): boolean {
  const path = seamRaiseLockPath(authDir);
  const claim = (): boolean => {
    const tmp = `${path}.${process.pid}`;
    writeFileSync(tmp, JSON.stringify({ pid: process.pid, started_at: Date.now() }), {
      mode: 0o600,
    });
    try {
      linkSync(tmp, path); // атомарно; EEXIST — держит другой
      return true;
    } catch {
      return false;
    } finally {
      try {
        unlinkSync(tmp);
      } catch {}
    }
  };
  try {
    mkdirSync(authDir, { recursive: true, mode: 0o700 });
    if (claim()) return true;
    const held = JSON.parse(readFileSync(path, "utf8")) as RaiseLock;
    if (pidAlive(held.pid) && Date.now() - held.started_at < RAISE_STALE_MS) return false;
  } catch {}
  debug("breaking a daemon raise lock nobody is holding");
  try {
    unlinkSync(path);
  } catch {}
  try {
    return claim();
  } catch {
    return false;
  }
}

function dropRaiseLock(authDir: string): void {
  try {
    const path = seamRaiseLockPath(authDir);
    const l = JSON.parse(readFileSync(path, "utf8")) as RaiseLock;
    if (l.pid === process.pid) unlinkSync(path);
  } catch {}
}

/** Поднять демон отсоединённо; вернуть обещание его раннего конца (не встал). */
function raiseDaemon(authDir: string): Promise<string> | null {
  if (!takeRaiseLock(authDir)) return null; // поднимает другой — ждём его демона
  const entry = process.env.ISKRON_BRIDGE_DAEMON_ENTRY || SELF;
  log(`no bridge daemon for ${authDir} — raising one: ${entry} daemon`);
  try {
    const child = spawn(process.execPath, [entry, "daemon", "--auth-dir", authDir], {
      detached: true,
      stdio: "ignore",
      cwd: authDir,
      env: process.env,
      windowsHide: true,
    });
    child.unref();
    return new Promise((r) => {
      child.once("error", (e) => r(`the daemon did not start: ${e.message}`));
      child.once("exit", (code, sig) => r(`the daemon exited at once (${sig ?? `code ${code}`})`));
    });
  } catch (e) {
    return Promise.resolve(`the daemon did not start: ${(e as Error).message}`);
  }
}

// --- тонкий мост -------------------------------------------------------------

interface Flight {
  id: string | number;
  method: string;
  /** Байты кадра отданы ядру: демон мог его взять — исход неизвестен. */
  sent: boolean;
}

export function thinMain(argv: string[]): void {
  // Конфиг разобран здесь (log и debug читают его); движок поднимается им только в полном ходе.
  const cfg = parseArgs(argv);
  setConfig(cfg);
  const authDir = cfg.authDir;
  installCrashWords();
  const socketPath = seamSocketPath(authDir);

  let mode: "attaching" | "daemon" | "local" = "attaching";
  let link: SeamLink | null = null;
  let sessionId: string | null = null;
  let local: { session: BridgeSession; input: PassThrough } | null = null;
  let initCopy: JsonRpcMessage | null = null;
  let initSent = false;
  let initializedSeen = false;
  let word: string | null = null; // слово о полном ходе — в первый ответ тула
  let leaving: Promise<void> | null = null;
  let byeDone: (() => void) | null = null;
  const queue: JsonRpcMessage[] = [];
  const flights = new Map<string, Flight>();
  const replayIds = new Set<string>();
  let replays = 0;
  const key = (id: unknown) => JSON.stringify(id);
  const writeHarness = (m: JsonRpcMessage) => writeTo(process.stdout, JSON.stringify(m) + "\n");

  const toHarness = (msg: JsonRpcMessage) => {
    if (msg.method === undefined && msg.id !== undefined && msg.id !== null) {
      const k = key(msg.id);
      if (replayIds.delete(k)) return; // ответ переигранного initialize: харнес свой уже получил
      const f = flights.get(k);
      flights.delete(k);
      if (word && f?.method === "tools/call" && Array.isArray(msg.result?.content)) {
        msg.result.content.push({ type: "text", text: word });
        word = null;
      }
    }
    writeHarness(msg);
  };

  const toDaemon = (l: SeamLink, msg: JsonRpcMessage) => {
    if (msg.method === "initialize") initSent = true;
    const f = msg.method && msg.id != null ? flights.get(key(msg.id)) : undefined;
    l.send({ t: "rpc", msg }, (err) => {
      if (!err && f) f.sent = true;
    });
  };
  const toLocal = (msg: JsonRpcMessage) => {
    if (msg.method === "initialize") initSent = true;
    local?.input.write(JSON.stringify(msg) + "\n");
  };
  const dispatch = (msg: JsonRpcMessage) => {
    if (mode === "daemon" && link) toDaemon(link, msg);
    else if (mode === "local") toLocal(msg);
    else queue.push(msg);
  };
  // Сессия на той стороне новая, а харнес своё рукопожатие уже прошёл: мост
  // переигрывает его сам, своим id, и ответ харнесу не несёт.
  const replay = (send: (m: JsonRpcMessage) => void) => {
    if (!initCopy || !initSent) return;
    const id = `iskron-thin-replay-${++replays}`;
    replayIds.add(key(id));
    send({ ...initCopy, id });
    if (initializedSeen) send({ jsonrpc: "2.0", method: "notifications/initialized" });
  };

  const goLocal = (reason: string) => {
    if (mode === "local" || leaving) return;
    log(`${reason} — going as the full bridge inside this process`);
    word =
      `iskron-bridge ${BUILD}: ${reason}; this bridge runs as the full bridge in its own process ` +
      `(${DAEMON_ENV}=1 asked for the machine's daemon).`;
    const input = new PassThrough();
    const output = new PassThrough();
    startEngine(cfg);
    const session = openSession({ input, output });
    createInterface({ input: output, terminal: false }).on("line", (line) => {
      if (!line.trim()) return;
      try {
        toHarness(JSON.parse(line) as JsonRpcMessage);
      } catch {}
    });
    local = { session, input };
    mode = "local";
    replay(toLocal);
    for (const m of queue.splice(0)) dispatch(m);
  };

  const onWelcome = (l: SeamLink) => {
    if (leaving) return l.close();
    const w = l.welcome;
    const resumed = w.resumed && !!sessionId && w.session === sessionId;
    sessionId = w.session;
    link = l;
    mode = "daemon";
    log(
      `through the machine's bridge daemon ${w.build} (pid ${w.pid}), session ${sessionId}` +
        (resumed ? " — resumed" : ""),
    );
    l.onFrame((f) => {
      if (f.t === "rpc") toHarness(f.msg as JsonRpcMessage);
      else if (f.t === "bye-ok") byeDone?.();
    });
    l.onClose(() => {
      if (link !== l) return;
      link = null;
      if (leaving) return byeDone?.();
      lost();
    });
    if (!resumed) replay((m) => toDaemon(l, m));
    for (const m of queue.splice(0)) dispatch(m);
  };

  const lost = () => {
    mode = "attaching";
    replayIds.clear();
    log(
      `the link to the machine's bridge daemon broke — ${flights.size} call(s) in flight get a verdict; reattaching`,
    );
    for (const f of flights.values()) {
      writeHarness(
        syntheticError(
          f.id,
          "the link to this machine's bridge daemon broke before the answer came back",
          f.sent ? UNKNOWN : NOT_SENT,
        ),
      );
    }
    flights.clear();
    void attach();
  };

  const attach = async (): Promise<void> => {
    const deadline = Date.now() + ATTACH_MS;
    let raising: Promise<string> | null = null;
    let raiseFailed: string | null = null;
    try {
      for (;;) {
        if (leaving) return;
        try {
          const hello = helloFrame({ build: BUILD, path: SELF, argv, session: sessionId });
          return onWelcome(await connectSeam(socketPath, hello, HELLO_MS));
        } catch (e) {
          if (!(e instanceof SeamError)) throw e;
          if (e.kind === "refused")
            return goLocal(`the machine's bridge daemon refused this bridge: ${e.message}`);
          if (e.kind === "absent" && !raising) {
            raising = raiseDaemon(authDir);
            void raising?.then((why) => (raiseFailed = why));
          }
          if (raiseFailed) return goLocal(`no bridge daemon for ${authDir}: ${raiseFailed}`);
          if (Date.now() >= deadline)
            return goLocal(
              `no bridge daemon for ${authDir} answered in ${ATTACH_MS}ms (${e.message})`,
            );
          await sleep(POLL_MS);
        }
      }
    } finally {
      if (raising) dropRaiseLock(authDir);
    }
  };

  const rl = createInterface({ input: process.stdin, terminal: false });
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
    if (msg.method === "initialize") initCopy = msg;
    if (msg.method === "notifications/initialized") initializedSeen = true;
    if (msg.method && msg.id !== undefined && msg.id !== null)
      flights.set(key(msg.id), { id: msg.id, method: msg.method, sent: false });
    dispatch(msg);
  });

  const leave = (why: string): Promise<void> => (leaving ??= windDown(why));
  const windDown = async (why: string) => {
    debug(`${why} — winding down`);
    if (mode === "local" && local) {
      await local.session.leave(why);
    } else if (link) {
      const l = link;
      // bye: демон отвечает всё, что в полёте, снимает сессию и говорит bye-ok
      await new Promise<void>((resolve) => {
        byeDone = resolve;
        setTimeout(resolve, BYE_MS).unref?.();
        l.send({ t: "bye", why });
      });
      l.close();
    }
    // Чего демон не ответил (или что так и не ушло) — вердиктом: харнес мог ещё читать.
    for (const f of flights.values()) {
      writeHarness(
        syntheticError(
          f.id,
          "the bridge left before the machine's daemon answered",
          f.sent ? UNKNOWN : NOT_SENT,
        ),
      );
    }
    await flushStdout(process.stdout);
    process.exit(0);
  };
  rl.on("close", () => void leave("stdin closed, the harness is gone"));
  process.on("SIGTERM", () => void leave("SIGTERM"));
  let interrupted = false;
  process.on("SIGINT", () => {
    if (interrupted) process.exit(0);
    interrupted = true;
    void leave("SIGINT");
  });

  void attach().catch((e) => goLocal(`the seam failed: ${(e as Error)?.message ?? String(e)}`));
}

/**
 * `--version` при включённом тонком мосте: сборка этого файла и сборка демона
 * его каталога гранта — одной строкой каждая; первая строка та же, что всегда.
 */
export async function versionLines(args: string[]): Promise<string[]> {
  const lines = [BUILD];
  if (!daemonWanted()) return lines;
  const i = args.indexOf("--auth-dir");
  const authDir =
    (i >= 0 ? args[i + 1] : undefined) || process.env.ISKRON_BRIDGE_AUTH_DIR || defaultAuthDir();
  const path = seamSocketPath(authDir);
  try {
    const l = await connectSeam(
      path,
      helloFrame({ build: BUILD, path: SELF, argv: args, probe: true }),
      HELLO_MS,
    );
    lines.push(`daemon ${l.welcome.build} (pid ${l.welcome.pid}, ${path})`);
    l.close();
  } catch (e) {
    lines.push(`daemon: none answering at ${path} (${(e as Error).message})`);
  }
  return lines;
}
