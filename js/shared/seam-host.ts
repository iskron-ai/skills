// Сторона демона на шве «тонкий мост ↔ демон машины» (провод — seam.ts).
//
// Демон машины (шаг 2) берёт отсюда три вещи как есть:
//   listenSeam(authDir, onSocket) локальный вход (seam-entrance.ts): личный каталог
//                                 0700 этого пользователя, замок жизни демона, сокет
//                                 0600; мёртвый сокет убирается, живой — отказ
//   serveSeam(socket, host)       рукопожатие, ack, проводка rpc, bye, окно переподхвата
//   streamSeamSession(id, open)   сессия движка над потоками (bridge/session.ts
//                                 openSession) как SeamSession
// Хозяин (SeamHost) решает, какую сессию открыть на hello и какую вернуть по id.
import { chmodSync, unlinkSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";

import {
  checkHello,
  readFrames,
  type RpcMessage,
  SEAM_PROTOCOL,
  SEAM_REATTACH_GRACE_MS,
  type SeamFrame,
  type SeamHello,
  writeFrame,
} from "./seam.ts";
import {
  seamDaemonLockPath,
  seamEntranceProblem,
  seamSocketPath,
  takeFileLock,
} from "./seam-entrance.ts";

/** Сессия движка глазами шва. */
export interface SeamSession {
  readonly id: string;
  /** Сообщение харнеса — в сессию. */
  deliver(msg: RpcMessage): void;
  /** Куда сессия пишет харнесу: текущий сокет; null — связи нет, сказанное теряется. */
  attach(sink: ((msg: RpcMessage) => void) | null): void;
  /** Конец сессии; разрешается, когда всё в полёте отвечено. Повторный зов ждёт первого. */
  end(why: string): Promise<void>;
}

/** Хозяин сессий демона. */
export interface SeamHost {
  /** Сборка демона, `vX.Y.Z+хеш` — в welcome и refuse. */
  build: string;
  /** Новая сессия по рукопожатию; строка — отказ с этой причиной. */
  open(hello: SeamHello): SeamSession | string | Promise<SeamSession | string>;
  /** Живая сессия по id — для переподхвата; null — такой нет (новая откроется). */
  find(id: string): SeamSession | null;
  /** Слово демона в его лог. */
  log?(msg: string): void;
}

const HELLO_WAIT_MS = 5_000;

// Окно переподхвата: сессия, чей сокет закрылся без bye, ждёт свой тонкий мост
// столько-то, затем уходит тем же концом, что и по bye.
const graceTimers = new Map<SeamSession, NodeJS.Timeout>();
// Чей сокет сейчас несёт сессию: закрытие прежнего после переподхвата — не обрыв.
const owners = new Map<SeamSession, Socket>();

/** Обслужить одно соединение тонкого моста. */
export function serveSeam(socket: Socket, host: SeamHost, graceMs = SEAM_REATTACH_GRACE_MS): void {
  const say = (m: string) => host.log?.(m);
  let session: SeamSession | null = null;
  let helloSeen = false;
  let byeing = false;
  const early: SeamFrame[] = []; // кадры, пришедшие, пока хозяин открывал сессию
  const helloTimer = setTimeout(() => {
    if (!helloSeen) socket.destroy();
  }, HELLO_WAIT_MS);
  helloTimer.unref?.();
  socket.on("error", () => {}); // обрыв скажет close
  const refuse = (reason: string) => {
    say(`seam refused: ${reason}`);
    writeFrame(socket, { t: "refuse", seam: SEAM_PROTOCOL, build: host.build, reason });
    socket.end();
  };
  // Запрос отдаётся сессии только после того, как его ack ушёл ядру: нет ack у
  // тонкого моста — сессия запроса не видела, и «не отправлено» честно. Кадры
  // идут цепочкой — порядок прихода держится (initialize прежде initialized).
  let chain = Promise.resolve();
  const onFrame = (s: SeamSession, f: SeamFrame) => {
    if (f.t === "rpc") {
      const msg = f.msg;
      const request = msg.method !== undefined && msg.id !== undefined && msg.id !== null;
      chain = chain.then(
        () =>
          new Promise<void>((done) => {
            if (!request) {
              s.deliver(msg);
              return done();
            }
            writeFrame(socket, { t: "ack", id: msg.id as string | number }, (err) => {
              if (!err) s.deliver(msg);
              else say(`request ${JSON.stringify(msg.id)} not taken: its ack did not go out`);
              done();
            });
          }),
      );
    } else if (f.t === "bye") {
      byeing = true;
      owners.delete(s);
      chain = chain.then(() =>
        s.end(f.why || "bye").then(() => {
          writeFrame(socket, { t: "bye-ok" });
          socket.end();
        }),
      );
    }
  };
  readFrames(
    socket,
    (f) => {
      if (!helloSeen) {
        helloSeen = true;
        clearTimeout(helloTimer);
        const why = checkHello(f);
        if (why) return refuse(why);
        void accept(f as SeamHello);
        return;
      }
      if (session) onFrame(session, f);
      else early.push(f);
    },
    (line) => say(`unparseable seam line: ${line.slice(0, 120)}`),
  );
  const accept = async (hello: SeamHello) => {
    const welcome = (id: string | null, resumed: boolean) =>
      writeFrame(socket, {
        t: "welcome",
        seam: SEAM_PROTOCOL,
        build: host.build,
        pid: process.pid,
        session: id,
        resumed,
        ack: true,
      });
    if (hello.probe) {
      welcome(null, false);
      socket.end();
      return;
    }
    let s = hello.session ? host.find(hello.session) : null;
    const resumed = !!s;
    if (!s) {
      const opened = await host.open(hello);
      if (typeof opened === "string") return refuse(opened);
      s = opened;
    }
    const grace = graceTimers.get(s);
    if (grace) clearTimeout(grace);
    graceTimers.delete(s);
    session = s;
    owners.set(s, socket);
    welcome(s.id, resumed);
    s.attach((msg) => writeFrame(socket, { t: "rpc", msg }));
    say(
      `seam session ${s.id} ${resumed ? "resumed" : "opened"} for pid ${hello.pid} (${hello.build})`,
    );
    for (const f of early.splice(0)) onFrame(s, f);
  };
  socket.on("close", () => {
    clearTimeout(helloTimer);
    const s = session;
    if (!s || byeing || owners.get(s) !== socket) return;
    owners.delete(s);
    s.attach(null);
    say(`seam of session ${s.id} closed without bye — ending it in ${graceMs}ms unless reattached`);
    const t = setTimeout(() => {
      graceTimers.delete(s);
      void s.end("the thin bridge is gone (seam closed without bye)");
    }, graceMs);
    t.unref?.();
    graceTimers.set(s, t);
  });
}

/** Сессия над потоками: open получает вход и выход, как openSession движка. */
export function streamSeamSession(
  id: string,
  open: (io: { input: PassThrough; output: PassThrough }) => { leave(why: string): Promise<void> },
  onLost?: (msg: RpcMessage) => void,
): SeamSession {
  const input = new PassThrough();
  const output = new PassThrough();
  const engine = open({ input, output });
  let sink: ((msg: RpcMessage) => void) | null = null;
  createInterface({ input: output, terminal: false }).on("line", (line) => {
    if (!line.trim()) return;
    let msg: RpcMessage;
    try {
      msg = JSON.parse(line) as RpcMessage;
    } catch {
      return;
    }
    if (sink) sink(msg);
    else onLost?.(msg);
  });
  let ending: Promise<void> | null = null;
  return {
    id,
    deliver: (msg) => void input.write(JSON.stringify(msg) + "\n"),
    attach: (s) => void (sink = s),
    end: (why) =>
      (ending ??= engine
        .leave(why)
        .then(() => new Promise<void>((r) => setImmediate(r))) // последние строки выхода — до bye-ok
        .then(() => void input.end())),
  };
}

const fail = (code: string, message: string): NodeJS.ErrnoException =>
  Object.assign(new Error(message), { code });

/**
 * Поднять локальный вход демона этого каталога гранта. Порядок: вход личный
 * (иначе EUNSAFE), замок жизни демона взят (живой держатель — EADDRINUSE),
 * сокет на пути не отвечает (отвечает — EADDRINUSE, не отвязывается), только
 * тогда мёртвый сокет убирается и слушается новый, 0600. Замок снимается с
 * закрытием сервера и с выходом процесса.
 */
export async function listenSeam(authDir: string, onSocket: (s: Socket) => void): Promise<Server> {
  const bad = seamEntranceProblem(authDir);
  if (bad) throw fail("EUNSAFE", `the seam entrance is not private: ${bad}`);
  const lock = takeFileLock(seamDaemonLockPath(authDir), Infinity);
  if (!lock.held)
    throw fail("EADDRINUSE", lock.fault ?? `a daemon of ${authDir} is alive (its lock is held)`);
  const path = seamSocketPath(authDir);
  const win = process.platform === "win32";
  try {
    if (!win) {
      const alive = await new Promise<boolean>((r) => {
        const probe = connect(path);
        probe.once("connect", () => {
          probe.destroy();
          r(true);
        });
        probe.once("error", () => r(false));
      });
      if (alive) throw fail("EADDRINUSE", `a daemon already listens on ${path}`);
      try {
        unlinkSync(path); // сокет умершего демона
      } catch {}
    }
    const server = createServer(onSocket);
    await new Promise<void>((r, reject) => {
      server.once("error", reject);
      server.listen(path, () => r());
    });
    if (!win) chmodSync(path, 0o600);
    server.once("close", lock.release);
    process.once("exit", lock.release);
    return server;
  } catch (e) {
    lock.release();
    throw e;
  }
}
