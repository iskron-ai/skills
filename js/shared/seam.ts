// Шов «тонкий мост ↔ демон машины» — локальный протокол (шаг 1 к 7.0.0).
//
// Демон машины держит соединение с MCP и сокеты канала; мост агента тонкий:
// stdio харнеса он отдаёт демону своего каталога гранта по локальному входу.
// Этот модуль — обе стороны провода, без движка: кадрирование, рукопожатие,
// версии, ack, bye, ошибки. Вход (путь, личный каталог, замки) — seam-entrance.ts;
// сторону демона (приём, сессии, окно переподхвата) — seam-host.ts; тонкий
// мост — bridge/thin.ts.
//
// Провод — NDJSON поверх unix-сокета 0600 в личном каталоге (именованный канал
// под Windows): одна строка — один кадр `{t: …}`.
//   тонкий → демон  hello   первым кадром; версия шва, сборка, путь, argv, env, cwd, pid,
//                           session (переподхват по id локальной сессии), probe (только спросить сборку)
//   демон → тонкий  welcome сборка и pid демона, id локальной сессии, resumed, ack
//                   refuse  шов не той версии либо сессия не принята — с причиной
//   в обе стороны   rpc     JSON-RPC как есть, свои методы и уведомления тоже
//   демон → тонкий  ack     запрос с этим id принят сессией (кадр ack ушёл ядру прежде,
//                           чем запрос отдан сессии: нет ack — сессия запроса не видела)
//   тонкий → демон  bye     конец сессии по слову харнеса (stdin закрыт, SIGTERM)
//   демон → тонкий  bye-ok  сессия ушла: всё, что было в полёте, отвечено
//   демон → тонкий  log     слово сессии в stderr тонкого моста — харнес видит его, как видел
//                           stderr полного (шаг 2; тонкий мост шага 1 кадр пропускает)
//   демон → тонкий  handover демон передаёт места преемнику: связь сейчас оборвётся, и тонкий
//                           мост ждёт преемника, а не поднимает демон сам (шаг 2)
// Кадр незнакомого вида пропускается обеими сторонами: новое добавляется без смены версии.
// Закрытие сокета без bye (SIGKILL тонкого моста) — тот же конец сессии в
// демоне, по истечении окна переподхвата SEAM_REATTACH_GRACE_MS.
import { createHash } from "node:crypto";
import { connect, type Socket } from "node:net";

import { ENV_PREFIX, envName, PRODUCT } from "../delivery/index.ts";

/** Версия провода. Разные версии не говорят: демон отвечает refuse, тонкий мост идёт полным. */
export const SEAM_PROTOCOL = 2;

/** Сколько демон держит сессию, чей сокет закрылся без bye, в ожидании переподхвата. */
export const SEAM_REATTACH_GRACE_MS = 5_000;

/** Тонкий мост — умолчание; `0` — выключатель: полный мост в процессе (пробы, человек). */
export const DAEMON_ENV = envName("BRIDGE_DAEMON");
/** Выключатель прежнего имени: полный мост в процессе, что бы ни было. */
export const NO_DAEMON_ENV = envName("BRIDGE_NO_DAEMON");

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
  /** The thin bridge's delivery (since seam protocol 2, graph @nks/nks-dev, node #6815). */
  product: string;
  /** Сборка тонкого моста, `vX.Y.Z+хеш`. */
  build: string;
  /** Путь файла тонкого моста — какой копией запустил харнес. */
  path: string;
  /** argv моста после подкоманды: --satellite, --client-name, --auth-dir, адрес сервера… */
  argv: string[];
  /** Окружение харнеса, нужное сессии (seamEnv): без личного токена — он не едет по шву. */
  env: Record<string, string>;
  cwd: string;
  pid: number;
  /** Отпечаток личного токена моста (sha256, 16 знаков); null — вход по OAuth. Демон с другим — refuse. */
  patSha?: string | null;
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
  /** Демон подтверждает приём запросов кадром ack; нет — исход любого ушедшего запроса неизвестен. */
  ack?: boolean;
  /** Ответ на probe: сколько сессий держит демон (doctor). */
  sessions?: number;
  /** Ответ на probe: файл демона. */
  path?: string;
}

export interface SeamLog {
  t: "log";
  line: string;
}

export interface SeamHandover {
  t: "handover";
  why?: string;
}

export interface SeamAck {
  t: "ack";
  id: string | number;
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

export type SeamFrame =
  | SeamHello
  | SeamWelcome
  | SeamRefuse
  | SeamRpc
  | SeamAck
  | SeamBye
  | SeamByeOk
  | SeamLog
  | SeamHandover;

// --- рукопожатие -------------------------------------------------------------

/** Личный токен по шву не ездит: демон того же пользователя берёт его из своего окружения или файла гранта. */
export const TOKEN_ENV = envName("BRIDGE_TOKEN");

/** Отпечаток личного токена — сверить, что демон ходит тем же токеном; null — токена нет. */
export const patShaOf = (pat: string | null | undefined): string | null =>
  pat ? createHash("sha256").update(pat).digest("hex").slice(0, 16) : null;

// Окружение, которое нужно сессии в демоне: всё своё (ISKRON_*, кроме токена),
// корень плагина, место лока скиллов (XDG_STATE_HOME, shared/skilllock.ts), прокси
// и доверенные сертификаты. Остальное окружение харнеса демону не нужно.
const PASS_ENV = new Set([
  "CLAUDE_PLUGIN_ROOT",
  "XDG_STATE_HOME",
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

/** Ключ окружения сессии: его значение — слово харнеса, а не демона. */
export const isSessionEnvKey = (k: string): boolean =>
  k !== TOKEN_ENV && (k.startsWith(ENV_PREFIX) || PASS_ENV.has(k));

export function seamEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && isSessionEnvKey(k)) out[k] = v;
  return out;
}

// Демону, поднятому тонким мостом, — окружение сессии, свой токен и основа
// процесса (дом, пути, tmp, рантайм), не всё окружение харнеса.
const BASE_ENV = [
  "HOME",
  "USERPROFILE",
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
  "LANG",
  "LC_ALL",
  "BUN_BE_BUN",
  TOKEN_ENV,
];

export function daemonEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out = seamEnv(env);
  for (const k of BASE_ENV) if (env[k] !== undefined) out[k] = env[k]!;
  return out;
}

export function helloFrame(o: {
  build: string;
  path: string;
  argv: string[];
  session?: string | null;
  probe?: boolean;
  patSha?: string | null;
}): SeamHello {
  return {
    t: "hello",
    seam: SEAM_PROTOCOL,
    product: PRODUCT,
    build: o.build,
    path: o.path,
    argv: o.argv,
    env: seamEnv(),
    cwd: process.cwd(),
    pid: process.pid,
    session: o.session ?? null,
    patSha: o.patSha ?? null,
    ...(o.probe ? { probe: true } : {}),
  };
}

/** Причина отказа в рукопожатии; null — принято. */
export function checkHello(f: unknown): string | null {
  const h = f as Partial<SeamHello> | null;
  if (!h || h.t !== "hello") return "the first frame is not a hello";
  if (h.seam !== SEAM_PROTOCOL)
    return `seam protocol ${String(h.seam)} is not spoken here (this side speaks ${SEAM_PROTOCOL})`;
  if (h.product !== PRODUCT)
    return `the thin bridge belongs to the delivery ${String(h.product)} (this side is ${PRODUCT})`;
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
