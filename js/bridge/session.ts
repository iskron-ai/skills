// Сессия моста — всё, что идёт после stdio: разбор строк харнеса, доставка
// (deliver), стояние, двери, usage и уход. Полному мосту stdio подаёт процесс
// (main.ts); тонкому мосту в запасном ходе и демону машины — потоки (thin.ts,
// shared/seam.ts). Поведение одно и то же: разрез — только о том, откуда
// строки приходят и куда уходят ответы.
//
// Предел разреза сегодня: состояние движка глобально (CFG, transport, hold,
// выход streams), поэтому сессия одна на процесс, и происхождение сессии
// (SessionOrigin) ложится на процесс. Демон машины с многими сессиями зовёт
// openSession так же — поднять это состояние в объект сессии и есть его шаг.
import { createInterface } from "node:readline";
import { type Writable } from "node:stream";

import { isSessionEnvKey, patShaOf } from "../shared/seam.ts";
import { leaveJoinedCases } from "./caseexit.ts";
import { CFG, parseArgs, setConfig } from "./config.ts";
import { deliver } from "./deliver.ts";
import { errorMessage } from "./errors.ts";
import { releaseStanding, statusAddress } from "./hold.ts";
import { startDeafnessWatch } from "./leave.ts";
import { pendingFlow } from "./oauth/flow.ts";
import { tokenRequestsInFlight } from "./oauth/tokenrequest.ts";
import { holdFromEnv } from "./resume.ts";
import { publishStatusTo } from "./status.ts";
import { sleep } from "./store.ts";
import { debug, flushStdout, guardStream, log, setSessionOutput } from "./streams.ts";
import { type JsonRpcMessage } from "./types.ts";

/** How long a bridge left by its harness still waits for a pending login's click. */
const ORPHAN_FLOW_MS = Number(process.env.ISKRON_BRIDGE_ORPHAN_FLOW_MS) || 5 * 60_000;

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
  /** Откуда сессия; null — сессия этого процесса. Окружение сессии живёт здесь. */
  readonly origin: SessionOrigin | null;
}

/**
 * Откуда сессия — мост харнеса, каким его запустили: argv, окружение, cwd, pid,
 * отпечаток личного токена. Демон берёт его из рукопожатия шва (shared/seam.ts
 * SeamHello) как есть.
 */
export interface SessionOrigin {
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  pid: number;
  patSha?: string | null;
}

let originTaken = false;

// Пока движок читает окружение процесса, окружение сессии на него ложится —
// заменой ключей сессии (isSessionEnvKey), не слиянием: ключ, которого харнес
// не назвал, снимается, а не доживает от прошлой сессии. Личный токен — не ключ
// сессии: у демона свой (окружение подъёма или файл гранта), и отпечаток сессии
// с ним сверяется — другой токен — отказ, а не молчаливая подмена входа.
function applyOrigin(origin: SessionOrigin): void {
  for (const k of Object.keys(process.env))
    if (isSessionEnvKey(k) && !(k in origin.env)) delete process.env[k];
  for (const [k, v] of Object.entries(origin.env)) if (isSessionEnvKey(k)) process.env[k] = v;
  process.chdir(origin.cwd);
  const cfg = parseArgs(origin.argv);
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
 * С origin — сессия чужого моста (демон): его конфиг, окружение и cwd. Пока
 * состояние движка глобально, такая сессия одна на процесс; вторая — бросок,
 * как и отпечаток токена, не совпавший с демоном. Окружение, прочитанное
 * модулями при загрузке (ручки проб *_MS), — процесса.
 */
export function openSession(io: SessionIO, origin?: SessionOrigin): BridgeSession {
  if (origin) {
    if (originTaken) throw new Error("this engine holds one session per process");
    applyOrigin(origin);
    originTaken = true;
  }
  setSessionOutput(io.output);
  guardStream(io.output); // before the first write: a broken pipe is news, not a crash
  holdFromEnv(); // сокет из окружения без connect (отладка) либо возврат места по каталогу сессии (#5140)
  // Никто не слушает — мост уходит с места сам (#4895). Спутник сторожа не держит
  // по устройству: его место подписывает записи прогона, и уход по глухоте погасил бы его посреди работы.
  if (!CFG.satellite) startDeafnessWatch();

  const rl = createInterface({ input: io.input, terminal: false });
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
  // Уход один на процесс: харнес, гася мост, закрывает stdin И шлёт SIGTERM, и
  // второй уход выходил из процесса, не дождавшись, пока первый снимет
  // занятость с доски (#5140, D1). Кто пришёл вторым — ждёт первого.
  let leaving: Promise<void> | null = null;
  let markEnded!: () => void;
  const ended = new Promise<void>((resolve) => (markEnded = resolve));
  const leave = (why: string): Promise<void> => (leaving ??= windDown(why).finally(markEnded));
  const windDown = async (why: string) => {
    debug(`${why} — winding down`);
    // Спутник выходит из дел прогона сам (#6573), пока его место живо: конец
    // прогона — конец поручения, а истечение срока места оставил бы «slop».
    await leaveJoinedCases();
    // Занятость — слово ушедшего делателя: с концом сессии она снимается, иначе
    // доска показывает занятого там, где никого нет (#4895). Сокет и .key
    // отпускаются ПЕРВЫМИ: харнес, убивающий мост по короткой отсрочке, не должен
    // застать его в сетевом вызове с живым ключом — сторож ушёл бы на мёртвый сокет.
    const addr = statusAddress();
    // Сокет стояния живёт ровно столько, сколько сессия; у спутника — и записи держания нет: возврата с диска у него не бывает.
    releaseStanding(why, CFG.satellite);
    if (addr) await publishStatusTo(addr.url, "", 3000).catch(() => {});
    await Promise.allSettled([...pending, ...tokenRequestsInFlight]);
    await flushStdout(io.output); // an answer half-written is an answer not given
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
    await flushStdout(io.output);
  };
  rl.on("close", () => void leave("stdin closed, the harness is gone"));
  return { leave, ended, origin: origin ?? null };
}
