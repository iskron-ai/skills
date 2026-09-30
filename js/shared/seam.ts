// Шов «тонкий мост ↔ демон машины» — локальный протокол (шаг 1 к 7.0.0).
//
// Демон машины держит соединение с MCP и сокеты канала; мост агента тонкий:
// stdio харнеса он отдаёт демону своего каталога гранта по локальному входу.
// Этот модуль — обе стороны провода, без движка: пути, кадрирование,
// рукопожатие, версии, bye, ошибки. Сторону демона (приём, сессии, окно
// переподхвата) несёт seam-host.ts; тонкий мост — bridge/thin.ts.
//
// Провод — NDJSON поверх unix-сокета 0600 в личном каталоге (именованный канал
// под Windows): одна строка — один кадр `{t: …}`.
//   тонкий → демон  hello   первым кадром; версия шва, сборка, путь, argv, env, cwd, pid,
//                           session (переподхват по id локальной сессии), probe (только спросить сборку)
//   демон → тонкий  welcome сборка и pid демона, id локальной сессии, resumed
//                   refuse  шов не той версии либо сессия не принята — с причиной
//   в обе стороны   rpc     JSON-RPC как есть, свои методы и уведомления тоже
//   тонкий → демон  bye     конец сессии по слову харнеса (stdin закрыт, SIGTERM)
//   демон → тонкий  bye-ok  сессия ушла: всё, что было в полёте, отвечено
// Закрытие сокета без bye (SIGKILL тонкого моста) — тот же конец сессии в
// демоне, по истечении окна переподхвата SEAM_REATTACH_GRACE_MS.
import { createHash } from "node:crypto";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Версия провода. Разные версии не говорят: демон отвечает refuse, тонкий мост идёт полным. */
export const SEAM_PROTOCOL = 1;

/** Сколько демон держит сессию, чей сокет закрылся без bye, в ожидании переподхвата. */
export const SEAM_REATTACH_GRACE_MS = 5_000;

/** Включает тонкий мост (по умолчанию выключено, пока демона нет в поставке). */
export const DAEMON_ENV = "ISKRON_BRIDGE_DAEMON";
/** Выключатель: полный мост в процессе, что бы ни было. */
export const NO_DAEMON_ENV = "ISKRON_BRIDGE_NO_DAEMON";

/** Сообщение JSON-RPC — провод его не разбирает, только несёт. */
export interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export interface SeamHello {
  t: "hello";
  seam: number;
  /** Сборка тонкого моста, `vX.Y.Z+хеш`. */
  build: string;
  /** Путь файла тонкого моста — какой копией запустил харнес. */
  path: string;
  /** argv моста после подкоманды: --satellite, --client-name, --auth-dir, адрес сервера… */
  argv: string[];
  /** Окружение харнеса, нужное сессии (seamEnv). */
  env: Record<string, string>;
  cwd: string;
  pid: number;
  /** id локальной сессии для переподхвата; нет — новая сессия. */
  session?: string | null;
  /** Только спросить сборку демона (--version): сессии не открывать. */
  probe?: boolean;
}

export interface SeamWelcome {
  t: "welcome";
  seam: number;
  build: string;
  pid: number;
  /** id локальной сессии; null — ответ на probe. */
  session: string | null;
  /** Сессия та же, что названа в hello: initialize не переигрывается. */
  resumed: boolean;
}

export interface SeamRefuse {
  t: "refuse";
  seam: number;
  build: string;
  reason: string;
}

export interface SeamRpc {
  t: "rpc";
  msg: RpcMessage;
}

export interface SeamBye {
  t: "bye";
  why?: string;
}

export interface SeamByeOk {
  t: "bye-ok";
}

export type SeamFrame = SeamHello | SeamWelcome | SeamRefuse | SeamRpc | SeamBye | SeamByeOk;

// --- пути --------------------------------------------------------------------

/** Ключ демона — каталог гранта: один демон на грант. */
export const seamKey = (authDir: string): string =>
  createHash("sha256").update(resolve(authDir)).digest("hex").slice(0, 16);

// Путь unix-сокета ограничен ~104 байтами (macOS); длинный каталог гранта
// уводит сокет в личный каталог под tmp — ключ тот же.
const SUN_PATH_MAX = 100;

/** Локальный вход демона этого каталога гранта. */
export function seamSocketPath(authDir: string): string {
  const key = seamKey(authDir);
  if (process.platform === "win32") return `\\\\.\\pipe\\iskron-daemon-${key}`;
  const inDir = join(resolve(authDir), "daemon.sock");
  if (Buffer.byteLength(inDir) <= SUN_PATH_MAX) return inDir;
  return join(tmpdir(), `iskron-${process.getuid?.() ?? "u"}`, `${key}.sock`);
}

/** Замок выборов подъёма демона (по образцу refreshlock): поднимает один. */
export const seamRaiseLockPath = (authDir: string): string =>
  join(resolve(authDir), "daemon.raising");

// --- рукопожатие -------------------------------------------------------------

// Окружение, которое нужно сессии в демоне: всё своё (ISKRON_*), корень плагина,
// прокси и доверенные сертификаты. Остальное окружение харнеса демону не нужно.
const PASS_ENV = new Set([
  "CLAUDE_PLUGIN_ROOT",
  "NODE_EXTRA_CA_CERTS",
  "NODE_USE_ENV_PROXY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
]);

export function seamEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && (k.startsWith("ISKRON_") || PASS_ENV.has(k))) out[k] = v;
  }
  return out;
}

export function helloFrame(o: {
  build: string;
  path: string;
  argv: string[];
  session?: string | null;
  probe?: boolean;
}): SeamHello {
  return {
    t: "hello",
    seam: SEAM_PROTOCOL,
    build: o.build,
    path: o.path,
    argv: o.argv,
    env: seamEnv(),
    cwd: process.cwd(),
    pid: process.pid,
    session: o.session ?? null,
    ...(o.probe ? { probe: true } : {}),
  };
}

/** Причина отказа в рукопожатии; null — принято. */
export function checkHello(f: unknown): string | null {
  const h = f as Partial<SeamHello> | null;
  if (!h || h.t !== "hello") return "the first frame is not a hello";
  if (h.seam !== SEAM_PROTOCOL)
    return `seam protocol ${String(h.seam)} is not spoken here (this side speaks ${SEAM_PROTOCOL})`;
  if (!Array.isArray(h.argv) || typeof h.cwd !== "string" || typeof h.pid !== "number")
    return "the hello lacks argv, cwd or pid";
  return null;
}

// --- кадрирование ------------------------------------------------------------

/** Читать кадры из сокета: строка — кадр; строка, не ставшая JSON, — onBad. */
export function readFrames(
  socket: Socket,
  onFrame: (f: SeamFrame) => void,
  onBad: (line: string) => void = () => {},
): void {
  socket.setEncoding("utf8");
  let buf = "";
  socket.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let f: SeamFrame;
      try {
        f = JSON.parse(line) as SeamFrame;
      } catch {
        onBad(line);
        continue;
      }
      onFrame(f);
    }
  });
}

/** Записать кадр; cb — когда байты отданы ядру (err — не отданы: кадр не ушёл). */
export function writeFrame(
  socket: Socket,
  frame: SeamFrame,
  cb?: (err?: Error | null) => void,
): boolean {
  if (socket.destroyed || !socket.writable) {
    cb?.(new Error("the seam socket is closed"));
    return false;
  }
  return socket.write(JSON.stringify(frame) + "\n", cb);
}

// --- сторона тонкого моста ---------------------------------------------------

/** Почему связь с демоном не встала: нет демона, отказал, оборвалась до welcome. */
export class SeamError extends Error {
  kind: "absent" | "refused" | "broken";
  constructor(kind: "absent" | "refused" | "broken", message: string) {
    super(message);
    this.kind = kind;
  }
}

/** Связь тонкого моста с демоном после welcome. */
export interface SeamLink {
  readonly welcome: SeamWelcome;
  send(frame: SeamFrame, cb?: (err?: Error | null) => void): boolean;
  /** Кадры демона; пришедшие до подписки — не теряются. */
  onFrame(cb: (f: SeamFrame) => void): void;
  /** Связь оборвалась (демон ушёл, сокет закрыт). Один раз. */
  onClose(cb: () => void): void;
  close(): void;
}

const ABSENT = new Set(["ENOENT", "ECONNREFUSED", "ENOTSOCK", "ENOTDIR"]);

/** Подключиться к демону и пройти рукопожатие. Отказ — SeamError. */
export function connectSeam(path: string, hello: SeamHello, timeoutMs: number): Promise<SeamLink> {
  return new Promise((resolveLink, reject) => {
    const socket = connect(path);
    let welcome: SeamWelcome | null = null;
    const early: SeamFrame[] = [];
    let frameCb: ((f: SeamFrame) => void) | null = null;
    let closeCb: (() => void) | null = null;
    let closed = false;
    const fail = (e: SeamError) => {
      clearTimeout(timer);
      socket.destroy();
      reject(e);
    };
    const timer = setTimeout(
      () => fail(new SeamError("broken", `no welcome from the daemon in ${timeoutMs}ms`)),
      timeoutMs,
    );
    timer.unref?.();
    socket.on("error", (e: NodeJS.ErrnoException) => {
      if (welcome) return; // после welcome ошибка — это закрытие, его скажет close
      fail(new SeamError(ABSENT.has(e.code ?? "") ? "absent" : "broken", `${e.code ?? e.message}`));
    });
    socket.on("close", () => {
      if (!welcome) {
        fail(new SeamError("broken", "the daemon closed the seam before its welcome"));
        return;
      }
      if (closed) return;
      closed = true;
      closeCb?.();
    });
    socket.on("connect", () => writeFrame(socket, hello));
    readFrames(socket, (f) => {
      if (!welcome) {
        if (f.t === "refuse") return fail(new SeamError("refused", f.reason));
        if (f.t !== "welcome") return fail(new SeamError("broken", `expected welcome, got ${f.t}`));
        welcome = f;
        clearTimeout(timer);
        resolveLink({
          welcome: f,
          send: (frame, cb) => writeFrame(socket, frame, cb),
          onFrame: (cb) => {
            frameCb = cb;
            for (const e of early.splice(0)) cb(e);
          },
          onClose: (cb) => {
            closeCb = cb;
            if (closed) cb();
          },
          close: () => {
            socket.end();
            setTimeout(() => socket.destroy(), 1000).unref?.();
          },
        });
        return;
      }
      if (frameCb) frameCb(f);
      else early.push(f);
    });
  });
}
