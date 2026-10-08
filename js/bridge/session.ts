// Сессия моста — всё, что идёт после stdio: разбор строк харнеса, доставка
// (deliver), стояние, двери, usage и уход. Полному мосту stdio подаёт процесс
// (main.ts); тонкому мосту в запасном ходе и демону машины — потоки (thin.ts,
// shared/seam.ts). Поведение одно и то же: разрез — только о том, откуда
// строки приходят и куда уходят ответы.
//
// Сессия этого процесса (полный мост, запасной ход тонкого) живёт в области
// процесса. Сессия чужого моста (демон машины, daemon.ts) — в своей области
// (shared/scope.ts): её конфиг, транспорт, место, поток вывода, pid, cwd и
// окружение — моста харнеса, и сессий в одном процессе сколько угодно.
import { createInterface } from "node:readline";
import { type Writable } from "node:stream";

import { envName } from "../delivery/index.ts";
import { bindScope, newScope, runIn, type Scope } from "../shared/scope.ts";
import { isSessionEnvKey, patShaOf } from "../shared/seam.ts";
import { CFG, readArgs, setConfig } from "./config.ts";
import { deliver } from "./deliver.ts";
import { errorMessage } from "./errors.ts";
import { handoverUnderway } from "./holdstate.ts";
import { startDeafnessWatch } from "./leave.ts";
import { clickPending } from "./oauth/flow.ts";
import { ORPHAN_FLOW_MS } from "./oauth/pacing.ts";
import { tokenRequestsInFlight } from "./oauth/tokenrequest.ts";
import { holdFromEnv } from "./resume.ts";
import { closeRun } from "./runend.ts";
import { releaseSatelliteClaims } from "./satellite.ts";
import { sleep } from "./store.ts";
import { debug, flushStdout, guardStream, log, setSessionOutput } from "./streams.ts";
import { pauseSettled, suspended } from "./suspend.ts";
import { type JsonRpcMessage } from "./types.ts";
import { lastAgentWork, noteAgentWork } from "./work.ts";

/** Сколько сессия демона, передающего места преемнику, ждёт вызовов в полёте: остальное тонкий мост закроет вердиктом. */
const HANDOVER_WAIT_MS = Number(process.env[envName("BRIDGE_HANDOVER_WAIT_MS")]) || 10_000;

/** Откуда сессия читает строки харнеса и куда пишет ответы. */
export interface SessionIO {
  input: NodeJS.ReadableStream;
  output: Writable;
}

export interface BridgeSession {
  /** Уход один на сессию: кто пришёл вторым — ждёт первого. Процесс не гасит. */
  leave(why: string): Promise<void>;
  /** Сессия ушла: вход закрыт (или позван leave) и всё отвечено. */
  readonly ended: Promise<void>;
  /** Откуда сессия; null — сессия этого процесса. */
  readonly origin: SessionOrigin | null;
  /** Область сессии (shared/scope.ts): демон исполняет в ней то, что говорит сессии сам. */
  readonly scope: Scope | null;
  /** Миг последнего вызова тула агентом (мс эпохи; 0 — не было): точка хартбита места, #6510 (work.ts). */
  lastWork(): number;
}

/**
 * Откуда сессия — мост харнеса, каким его запустили: argv, окружение, cwd, pid,
 * файл моста, отпечаток личного токена. Демон берёт его из рукопожатия шва
 * (shared/seam.ts SeamHello) как есть.
 */
export interface SessionOrigin {
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  pid: number;
  path?: string;
  patSha?: string | null;
}

/** Опции сессии чужого моста: id в журнале и куда идёт её слово log. */
export interface SessionOptions {
  id?: string;
  log?: (line: string) => void;
}

let counter = 0;

// Конфиг сессии — из argv и окружения моста харнеса, в её области: ключи
// сессии (isSessionEnvKey) — его слово, остальное — процесса. Личный токен —
// не ключ сессии: у демона свой (окружение подъёма или файл гранта), и
// отпечаток сессии с ним сверяется — другой токен — отказ, а не молчаливая
// подмена входа. Окружение, прочитанное модулями при загрузке (ручки проб
// *_MS), — процесса.
function applyOrigin(origin: SessionOrigin): void {
  const cfg = readArgs(origin.argv);
  if (origin.patSha !== undefined && patShaOf(cfg.pat) !== origin.patSha)
    throw new Error(
      "this daemon signs in otherwise than the bridge asking (its personal token differs)",
    );
  setConfig(cfg);
}

/**
 * Открыть сессию моста над потоками. Конец входа — уход сессии (как закрытый
 * stdin у полного моста); выходить ли процессу — решает хозяин сессии.
 * Без origin — сессия этого процесса: setConfig уже позван (main.ts, thin.ts).
 * С origin — сессия чужого моста (демон) в своей области: негодный argv или
 * чужой токен — бросок, и хозяин отказывает сессии.
 */
export function openSession(
  io: SessionIO,
  origin?: SessionOrigin,
  opts: SessionOptions = {},
): BridgeSession {
  if (!origin) return openIn(io, null, null);
  const scope = newScope(
    opts.id ?? `s${++counter}`,
    { env: origin.env, cwd: origin.cwd, pid: origin.pid, path: origin.path ?? "" },
    isSessionEnvKey,
  );
  scope.log = opts.log ?? null;
  return runIn(scope, () => {
    applyOrigin(origin);
    return openIn(io, origin, scope);
  });
}

function openIn(io: SessionIO, origin: SessionOrigin | null, scope: Scope | null): BridgeSession {
  setSessionOutput(io.output);
  guardStream(io.output); // before the first write: a broken pipe is news, not a crash
  holdFromEnv(); // сокет из окружения без connect (отладка) либо возврат места по каталогу сессии (#5140)
  // Никто не слушает — мост уходит с места сам (#4895). Спутник сторожа не держит
  // по устройству: его место подписывает записи прогона, и уход по глухоте погасил бы его посреди работы.
  if (!CFG.satellite) startDeafnessWatch();

  const rl = createInterface({ input: io.input, terminal: false });
  const pending = new Set<Promise<void>>();
  let handshake: Promise<void> | null = null;
  // Строки входа приходят событием потока — из области того, кто пишет в поток
  // (у демона — сокет шва): сессия исполняет их в своей.
  rl.on(
    "line",
    bindScope((line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(trimmed) as JsonRpcMessage;
      } catch {
        log(`unparseable line from harness: ${trimmed.slice(0, 120)}`);
        return;
      }
      // Последняя работа агента (work.ts, хартбит места #6510): только вызов тула
      // агентом — не служебные ходы плагина (iskron/check, iskron/usage) и моста.
      if (msg.method === "tools/call" && !String(msg.id ?? "").startsWith("iskron-"))
        noteAgentWork();
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
    }),
  );
  // A human may be mid-click on OUR authorize URL (the loopback link opened):
  // dying now kills the callback server and silently loses their login, and the click is not repeatable —
  // the human sees a browser error, not a retry. So a bridge asked to go away
  // outlives a pending flow, and a token rotation already in flight must land
  // on disk before exit; each request's own timeout bounds the wait. A harness
  // that will not wait that long may kill us outright. That is survivable for
  // the browser flow: the next bridge finds no listener on the callback port
  // and takes the flow over. It is NOT survivable for an in-flight rotation:
  // the killed bridge leaves the machine holding a retired refresh token. That
  // is the price SIGKILL always pays; SIGTERM, stdin-close, and SIGINT no longer do.
  // Уход один на процесс: харнес, гася мост, закрывает stdin И шлёт SIGTERM, и
  // второй уход выходил из процесса, не дождавшись, пока первый снимет
  // занятость с доски (#5140, D1). Кто пришёл вторым — ждёт первого.
  // У сессии демона вход и процесс не совпадают: вход её ждёт демон, не она.
  let leaving: Promise<void> | null = null;
  let markEnded!: () => void;
  const ended = new Promise<void>((resolve) => (markEnded = resolve));
  const leave = bindScope(
    (why: string): Promise<void> => (leaving ??= windDown(why).finally(markEnded)),
  );
  const windDown = async (why: string) => {
    debug(`${why} — winding down`);
    // Демон передаёт места преемнику (daemon.ts): место не отпускается словом,
    // занятость не снимается, а вызовов в полёте ждём коротко — тонкий мост
    // закроет неотвеченное вердиктом и переотправит неотправленное.
    const handover = !!origin && handoverUnderway();
    const paused = suspended();
    // Место, дела, занятость, снимок расхода — runend.ts; сбой не обрывает уход (e2e12, №147).
    await closeRun(why, handover).catch((e: Error) => log(`the run's end failed: ${e.message}`));
    if (handover) await Promise.race([Promise.allSettled([...pending]), sleep(HANDOVER_WAIT_MS)]);
    else await Promise.allSettled([...pending, ...tokenRequestsInFlight]);
    if (paused) await pauseSettled(); // поздний перевзвод паузы повернул адрес — запись за ним
    await flushStdout(io.output); // an answer half-written is an answer not given
    if (origin) {
      // Сессия демона: вход по OAuth и ротация токена — процесса-демона, он живёт
      // дольше сессии и их дождётся сам; имена спутника свободны с концом сессии.
      releaseSatelliteClaims();
      return;
    }
    const flow = clickPending();
    if (flow) {
      // The login has no deadline while a harness holds us; once it is gone,
      // the click is waited for only so long — nothing is left hanging forever.
      // A login whose link nobody opened — a code polled for another device —
      // is not waited for: the record keeps link and code, the next bridge takes
      // both over, and a harness stopping us is not made to kill us.
      log(
        `${why}, but an authorization flow is pending — staying up for the human's click, ` +
          `at most ${Math.round(ORPHAN_FLOW_MS / 1000)}s`,
      );
      await Promise.race([flow.catch(() => {}), sleep(ORPHAN_FLOW_MS)]);
    }
    await Promise.allSettled([...tokenRequestsInFlight]); // a tick may have started one while we waited
    await flushStdout(io.output);
  };
  rl.on(
    "close",
    bindScope(() => void leave("stdin closed, the harness is gone")),
  );
  return { leave, ended, origin, scope, lastWork: bindScope(lastAgentWork) };
}
