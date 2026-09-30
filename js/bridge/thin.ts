// Тонкий мост — сторона агента на шве «тонкий мост ↔ демон машины» (провод —
// shared/seam.ts, вход — shared/seam-entrance.ts, демон — daemon.ts). Держит
// stdio харнеса и отдаёт всё демону своего каталога гранта: JSON-RPC как есть в
// обе стороны. Сам хранит только то, без чего обрыв стал бы молчанием или
// потерей: копию initialize харнеса, вызовы в полёте и ключ места, которое держит
// его сессия.
//
//   демона нет      поднимает его отсоединённо (`iskron.mjs daemon`, копией новее из
//                   своей и домашней) под выборами (замок подъёма в личном каталоге шва);
//                   не встал, вход не личный, замка не взять — полный мост в процессе, и
//                   мост говорит это: stderr и первый ответ тула. Поднятый демон ушёл
//                   кодом «демон уже есть» — ждать живого, а не идти полным
//   обрыв связи     запрос, чей приём демон подтвердил (ack), — вердикт «исход
//                   неизвестен»; не подтверждённый демоном, говорящим ack, сессия не
//                   видела — он переотправляется после переподхвата сам, вместо ошибки;
//                   демон без ack — «исход неизвестен» всегда. Закрытый вердиктом id
//                   помнится: настоящий ответ, пришедший после, харнесу не идёт. Затем
//                   переподхват по id локальной сессии; сессия новая — initialize
//                   переигрывается, место сессии возвращается по записи держания
//                   (запрос iskron/resume с его ключом)
//   конец           stdin закрыт, SIGTERM — bye демону с ограниченным ожиданием
//
// За флагом ISKRON_BRIDGE_DAEMON=1 (по умолчанию полный мост, как было);
// ISKRON_BRIDGE_NO_DAEMON=1 — полный мост всегда. Выравнивание дома при старте
// (cli: syncHome/reexec) тонкий мост делает сам, как полный; сверку с релизами
// GitHub — никогда: её ведёт только демон (в полном ходе — движок, как у полного).
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import { homeBridgePath } from "../shared/home.ts";
import {
  connectSeam,
  DAEMON_ENV,
  daemonEnv,
  helloFrame,
  NO_DAEMON_ENV,
  patShaOf,
  SeamError,
  type SeamLink,
} from "../shared/seam.ts";
import {
  seamEntranceProblem,
  seamRaiseLockPath,
  seamRunDir,
  seamSocketPath,
  takeFileLock,
} from "../shared/seam-entrance.ts";
import { compareVersions } from "../shared/semver.ts";
import { VERSION, versionIn } from "../shared/version.ts";
import { BUILD } from "./build.ts";
import { parseArgs, setConfig } from "./config.ts";
import { DAEMON_BUSY_EXIT } from "./daemon.ts";
import { syntheticError } from "./deliver.ts";
import { fullBridgeSigint, installCrashWords, startEngine } from "./engine.ts";
import { NOT_SENT, UNKNOWN } from "./errors.ts";
import { type BridgeSession, openSession } from "./session.ts";
import { sleep } from "./store.ts";
import { debug, flushStdout, log, writeTo } from "./streams.ts";
import { type JsonRpcMessage } from "./types.ts";
import { updatesDisabled } from "./update.ts";

const ms = (name: string, dflt: number): number => {
  const v = Number(process.env[name]);
  return process.env[name]?.trim() && Number.isFinite(v) && v >= 0 ? v : dflt;
};
/** Сколько ждать демона — своего или поднятого — прежде чем идти полным мостом. */
const ATTACH_MS = ms("ISKRON_BRIDGE_DAEMON_WAIT_MS", 5_000);
/** Сколько ждать демона после обрыва: уходящий демон передаёт места преемнику — тот встаёт не сразу. */
const REATTACH_MS = ms("ISKRON_BRIDGE_DAEMON_REATTACH_MS", 30_000);
/** Сколько ждать bye-ok на уходе. */
const BYE_MS = ms("ISKRON_BRIDGE_BYE_MS", 5_000);
const HELLO_MS = 3_000;
const POLL_MS = 100;
/** Замок подъёма, чей хозяин жив, но держит его дольше, — брошен. */
const RAISE_STALE_MS = 15_000;
/** Сколько ждать преемника, которого назвал уходящий демон, прежде чем поднять демон самому. */
const SUCCESSOR_MS = 20_000;
/** Поднятый демон ушёл словом «демон уже есть» — поднимать снова не раньше этой паузы. */
const BUSY_RETRY_MS = 2_000;

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

/**
 * Какой копией поднимать демон: названной переменной, иначе самой новой из
 * своей и домашней — демон, поднятый старой копией, тут же передал бы места
 * новой. Под ISKRON_BRIDGE_NO_UPDATE дом не читается (пробы).
 */
function daemonEntry(): string {
  const named = process.env.ISKRON_BRIDGE_DAEMON_ENTRY?.trim();
  if (named) return named;
  if (updatesDisabled()) return SELF;
  const home = homeBridgePath();
  try {
    const v = versionIn(readFileSync(home, "utf8"));
    if (home !== SELF && compareVersions(v, VERSION) > 0) return home;
  } catch {}
  return SELF;
}

// --- подъём ------------------------------------------------------------------

type Raise =
  | { kind: "raising"; release(): void; failed: Promise<{ code: number | null; why: string }> }
  | { kind: "other" } // поднимает другой — ждём его демона
  | { kind: "fault"; why: string }; // замка не взять — ждать нечего

/** Поднять демон отсоединённо под замком выборов. */
function raiseDaemon(authDir: string): Raise {
  const lock = takeFileLock(seamRaiseLockPath(authDir), RAISE_STALE_MS);
  if (!lock.held) return lock.fault ? { kind: "fault", why: lock.fault } : { kind: "other" };
  const entry = daemonEntry();
  log(`no bridge daemon for ${authDir} — raising one: ${entry} daemon`);
  try {
    // Демону — окружение сессии, токен и основа процесса, не всё окружение харнеса.
    const child = spawn(process.execPath, [entry, "daemon", "--auth-dir", authDir], {
      detached: true,
      stdio: "ignore",
      cwd: seamRunDir(authDir),
      env: daemonEnv(),
      windowsHide: true,
    });
    child.unref();
    const failed = new Promise<{ code: number | null; why: string }>((r) => {
      child.once("error", (e) => r({ code: null, why: `the daemon did not start: ${e.message}` }));
      child.once("exit", (code, sig) =>
        r({ code, why: `the daemon exited at once (${sig ?? `code ${code}`})` }),
      );
    });
    return { kind: "raising", release: lock.release, failed };
  } catch (e) {
    lock.release();
    return { kind: "fault", why: `the daemon did not start: ${(e as Error).message}` };
  }
}

// --- тонкий мост -------------------------------------------------------------

interface Flight {
  id: string | number;
  msg: JsonRpcMessage;
  /** Демон подтвердил приём (ack): сессия запрос видела — исход неизвестен. */
  acked: boolean;
}

/** Слово сессии о месте, которое она держит или отпустила (hold.ts notify). */
function placeWord(msg: JsonRpcMessage): { kind: string; key?: string } | null {
  if (msg.method !== "notifications/message" || msg.params?.logger !== "iskron-channel")
    return null;
  const data = msg.params?.data as { kind?: unknown; key?: unknown } | undefined;
  return typeof data?.kind === "string"
    ? { kind: data.kind, key: typeof data.key === "string" ? data.key : undefined }
    : null;
}

export function thinMain(argv: string[]): void {
  // Конфиг разобран здесь (log и debug читают его); движок поднимается им только в полном ходе.
  const cfg = parseArgs(argv);
  setConfig(cfg);
  const authDir = cfg.authDir;
  const patSha = patShaOf(cfg.pat);
  installCrashWords();

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
  let heldKey: string | null = null; // место, которое держит сессия, — вернуть его в новой сессии
  let everAttached = false;
  let successorAwaited = 0; // миг, когда уходящий демон назвал преемника
  const queue: JsonRpcMessage[] = [];
  const flights = new Map<string, Flight>();
  const verdicted = new Set<string>(); // id, закрытые вердиктом: их поздний ответ — дубль
  const replayIds = new Set<string>();
  let replays = 0;
  const key = (id: unknown) => JSON.stringify(id);
  const writeHarness = (m: JsonRpcMessage) => writeTo(process.stdout, JSON.stringify(m) + "\n");

  const toHarness = (msg: JsonRpcMessage) => {
    if (msg.method === undefined && msg.id !== undefined && msg.id !== null) {
      const k = key(msg.id);
      if (replayIds.delete(k)) return; // ответ хода самого моста (initialize, resume): харнес свой уже получил
      if (verdicted.delete(k)) {
        debug(`a late answer to ${k} dropped — the harness already has its verdict`);
        return;
      }
      const f = flights.get(k);
      flights.delete(k);
      if (word && f?.msg.method === "tools/call" && Array.isArray(msg.result?.content)) {
        msg.result.content.push({ type: "text", text: word });
        word = null;
      }
    }
    const place = placeWord(msg);
    if (place?.kind === "held" && place.key) heldKey = place.key;
    else if (
      place &&
      ["released", "dead", "evicted"].includes(place.kind) &&
      (!place.key || place.key === heldKey)
    )
      heldKey = null;
    writeHarness(msg);
  };

  // Вердикт каждому id в полёте — и память о нём, чтобы поздний ответ не стал вторым.
  // Неподтверждённый запрос демона, говорящего ack, сессия не видела: при
  // `resend` он не закрывается вердиктом, а встаёт в очередь — уйдёт снова.
  const verdictAll = (why: string, acks: boolean, resend = false): JsonRpcMessage[] => {
    const again: JsonRpcMessage[] = [];
    for (const [k, f] of flights) {
      if (resend && acks && !f.acked) {
        again.push(f.msg);
        continue;
      }
      writeHarness(syntheticError(f.id, why, !acks || f.acked ? UNKNOWN : NOT_SENT));
      verdicted.add(k);
      flights.delete(k);
    }
    return again;
  };

  const toDaemon = (l: SeamLink, msg: JsonRpcMessage) => {
    if (msg.method === "initialize") initSent = true;
    const f = msg.id !== undefined && msg.id !== null ? flights.get(key(msg.id)) : undefined;
    if (f && f.msg === msg) f.acked = false; // уходит заново — ждёт нового ack
    l.send({ t: "rpc", msg });
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
  // переигрывает его сам, своим id, и ответ харнесу не несёт; место, которое
  // держала прежняя сессия, возвращается по записи держания. Исходный initialize,
  // стоящий в очереди на переотправку, и есть рукопожатие — его не дублируем.
  const replay = (send: (m: JsonRpcMessage) => void) => {
    if (!initCopy || !initSent) return;
    if (!queue.some((m) => m.method === "initialize")) {
      const id = `iskron-thin-replay-${++replays}`;
      replayIds.add(key(id));
      send({ ...initCopy, id });
      if (initializedSeen) send({ jsonrpc: "2.0", method: "notifications/initialized" });
    }
    if (heldKey) {
      const id = `iskron-thin-resume-${++replays}`;
      replayIds.add(key(id));
      log(`the session is new — bringing its place ${heldKey} back from the hold record`);
      send({ jsonrpc: "2.0", id, method: "iskron/resume", params: { key: heldKey } });
    }
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
    everAttached = true;
    log(
      `through the machine's bridge daemon ${w.build} (pid ${w.pid}), session ${sessionId}` +
        (resumed ? " — resumed" : ""),
    );
    l.onFrame((f) => {
      if (f.t === "rpc") toHarness(f.msg as JsonRpcMessage);
      else if (f.t === "ack") {
        const fl = flights.get(key(f.id));
        if (fl) fl.acked = true;
      } else if (f.t === "log")
        writeTo(process.stderr, f.line.endsWith("\n") ? f.line : `${f.line}\n`);
      else if (f.t === "handover") {
        successorAwaited = Date.now();
        log(
          `the machine's bridge daemon hands over to its successor (${f.why ?? "?"}) — waiting for it`,
        );
      } else if (f.t === "bye-ok") byeDone?.();
    });
    l.onClose(() => {
      if (link !== l) return;
      link = null;
      if (leaving) return byeDone?.();
      lost(!!w.ack);
    });
    if (!resumed) replay((m) => toDaemon(l, m));
    for (const m of queue.splice(0)) dispatch(m);
  };

  const lost = (acks: boolean) => {
    mode = "attaching";
    replayIds.clear();
    const inFlight = flights.size;
    const again = verdictAll(
      "the link to this machine's bridge daemon broke before the answer came back",
      acks,
      true,
    );
    log(
      `the link to the machine's bridge daemon broke — ${inFlight} call(s) in flight: ` +
        `${again.length} not taken by the daemon go again after the reattach, ` +
        `${inFlight - again.length} get a verdict; reattaching`,
    );
    queue.unshift(...again); // не ушедшие — первыми, в прежнем порядке
    void attach();
  };

  const attach = async (): Promise<void> => {
    const unsafe = seamEntranceProblem(authDir);
    if (unsafe) return goLocal(`the daemon's entrance is not private (${unsafe})`);
    const socketPath = seamSocketPath(authDir);
    const wait = everAttached ? REATTACH_MS : ATTACH_MS;
    const deadline = Date.now() + wait;
    let raise: Raise | null = null;
    let raiseFailed: string | null = null;
    let raiseAgainAt = 0;
    try {
      for (;;) {
        if (leaving) return;
        try {
          const hello = helloFrame({ build: BUILD, path: SELF, argv, session: sessionId, patSha });
          return onWelcome(await connectSeam(socketPath, hello, HELLO_MS));
        } catch (e) {
          if (!(e instanceof SeamError)) throw e;
          if (e.kind === "refused")
            return goLocal(`the machine's bridge daemon refused this bridge: ${e.message}`);
          // Уходящий демон назвал преемника — его и ждать: поднятый нами демон
          // спорил бы с ним за вход.
          const successorDue = !!successorAwaited && Date.now() - successorAwaited < SUCCESSOR_MS;
          if (e.kind === "absent" && !raise && !successorDue && Date.now() >= raiseAgainAt) {
            const r = raiseDaemon(authDir);
            raise = r;
            if (r.kind === "fault")
              return goLocal(`cannot raise the bridge daemon for ${authDir}: ${r.why}`);
            if (r.kind === "raising")
              void r.failed.then(({ code, why }) => {
                // «Демон уже есть» — жив уходящий или встаёт другой: ждать его, не идти
                // полным; поднять снова — не раньше паузы, иначе подъём за подъёмом.
                if (code !== DAEMON_BUSY_EXIT) return void (raiseFailed = why);
                r.release();
                if (raise === r) raise = null;
                raiseAgainAt = Date.now() + BUSY_RETRY_MS;
              });
          }
          if (raiseFailed) return goLocal(`no bridge daemon for ${authDir}: ${raiseFailed}`);
          if (Date.now() >= deadline)
            return goLocal(`no bridge daemon for ${authDir} answered in ${wait}ms (${e.message})`);
          await sleep(POLL_MS);
        }
      }
    } finally {
      if (raise?.kind === "raising") raise.release();
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
    if (msg.method && msg.id !== undefined && msg.id !== null) {
      verdicted.delete(key(msg.id)); // харнес взял id снова — его ответ уже не дубль
      flights.set(key(msg.id), { id: msg.id, msg, acked: false });
    }
    dispatch(msg);
  });

  const leave = (why: string): Promise<void> => (leaving ??= windDown(why));
  const windDown = async (why: string) => {
    debug(`${why} — winding down`);
    let acks = false;
    if (mode === "local" && local) {
      await local.session.leave(why);
    } else if (link) {
      const l = link;
      acks = !!l.welcome.ack;
      // bye: демон отвечает всё, что в полёте, снимает сессию и говорит bye-ok
      await new Promise<void>((resolve) => {
        byeDone = resolve;
        setTimeout(resolve, BYE_MS).unref?.();
        l.send({ t: "bye", why });
      });
      l.close();
    } else acks = true; // связи нет: всё, что ждёт переотправки, так и не ушло
    // Чего демон не ответил (или что так и не ушло) — вердиктом: харнес мог ещё читать.
    verdictAll("the bridge left before the machine's daemon answered", acks);
    await flushStdout(process.stdout);
    process.exit(0);
  };
  rl.on("close", () => void leave("stdin closed, the harness is gone"));
  process.on("SIGTERM", () => void leave("SIGTERM"));
  // Ctrl-C: в полном ходе — как у полного моста (выход сразу, без ожидания
  // входа); через демон — bye, второй Ctrl-C выходит сразу.
  const localSigint = fullBridgeSigint();
  let interrupted = false;
  process.on("SIGINT", () => {
    if (mode === "local") return localSigint();
    if (interrupted) process.exit(0);
    interrupted = true;
    void leave("SIGINT");
  });

  void attach().catch((e) => goLocal(`the seam failed: ${(e as Error)?.message ?? String(e)}`));
}
