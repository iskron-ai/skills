// Демон машины — сторона демона на шве «тонкий мост ↔ демон» (шаг 2 к 7.0.0;
// провод — shared/seam.ts, вход — shared/seam-entrance.ts, приём —
// shared/seam-host.ts). Решения владельца: демон держит соединение с MCP и
// сокеты канала api по одному на место, как сегодня мосты; мосты агентов
// тонкие; обновил демон — обновил все мосты; обновления с GitHub проверяет
// только демон; доставка без потерь; полный мост — запасной путь.
//
//   node iskron.mjs daemon --auth-dir <dir> [--successor]
//
//   один на грант   замок жизни и сокет listenSeam; второй — уходит кодом DAEMON_BUSY_EXIT
//                   (тонкий мост, поднявший его, ждёт живого, а не идёт полным)
//   сессии          Map id → сессия движка в своей области (session.ts, shared/scope.ts):
//                   конфиг, транспорт, место, вывод, pid, cwd, окружение — моста харнеса
//   простой         последняя сессия ушла — через окно простоя демон уходит сам
//   обновление      только демон сверяется с релизами; домашняя копия новее (скачал сам,
//                   положил новый тонкий мост) или тонкий мост новее — демон передаёт места
//                   преемнику: не принимает новых запросов (без ack тонкий мост переотправит
//                   их преемнику), ждёт вызовов в полёте, закрывает двери мест без слова
//                   «отпущено» и без снятия занятости, поднимает преемника новой копией;
//                   тонкие мосты переподхватываются, места возвращаются по записи
//                   держания (resume.ts); сокеты мест уходящий держит до вытеснения
//                   преемником, пришедшее досылает ему спулом (handoff.ts), и уходит
//   журнал          <каталог гранта>/run/daemon.log — слово демона и его сессий
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { type Server, type Socket } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { homeBridgePath } from "../shared/home.ts";
import { runIn } from "../shared/scope.ts";
import { type SeamHello, writeFrame } from "../shared/seam.ts";
import { ownPidAlive, seamRunDir, seamSocketPath } from "../shared/seam-entrance.ts";
import {
  listenSeam,
  type SeamHost,
  type SeamSession,
  serveSeam,
  streamSeamSession,
} from "../shared/seam-host.ts";
import { compareVersions } from "../shared/semver.ts";
import { VERSION, versionIn } from "../shared/version.ts";
import { BUILD } from "./build.ts";
import { parseArgs } from "./config.ts";
import { installCrashWords, startEngine } from "./engine.ts";
import { errorMessage } from "./errors.ts";
import { handoffsSettled } from "./handoff.ts";
import { beginHandover, beginSessionHandover } from "./holdstate.ts";
import { pendingFlow } from "./oauth/flow.ts";
import { type BridgeSession, openSession } from "./session.ts";
import { log, setProcessLog } from "./streams.ts";
import {
  pendNotice,
  startFreshnessWatch,
  syncHome,
  tellNotice,
  updatesDisabled,
} from "./update.ts";

const ms = (name: string, dflt: number): number => {
  const v = Number(process.env[name]);
  return process.env[name]?.trim() && Number.isFinite(v) && v >= 0 ? v : dflt;
};
/** Окно простоя: столько демон живёт после ухода последней сессии. */
const IDLE_MS = ms("ISKRON_BRIDGE_DAEMON_IDLE_MS", 60_000);
/** Как часто демон смотрит на домашнюю копию (дешёвая сверка по mtime). */
const HOME_CHECK_MS = ms("ISKRON_BRIDGE_DAEMON_HOME_CHECK_MS", 60_000);
/** Сколько преемник ждёт, пока уходящий отпустит вход. */
const SUCCESSOR_WAIT_MS = ms("ISKRON_BRIDGE_DAEMON_SUCCESSOR_WAIT_MS", 20_000);
/** Сколько демон держит сессию, чей шов закрылся без bye (переподхват). */
const GRACE_MS = ms("ISKRON_BRIDGE_DAEMON_GRACE_MS", 5_000);
const JOURNAL_MAX = 256_000;

/** Код выхода: демон этого гранта уже жив (или встаёт) — поднявшему ждать его, а не идти полным. */
export const DAEMON_BUSY_EXIT = 75;

const SELF = (() => {
  try {
    return fileURLToPath(import.meta.url);
  } catch {
    return process.argv[1] ?? "";
  }
})();

const versionOfFile = (path: string): string | null => {
  try {
    return versionIn(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

export async function daemonMain(argv: string[]): Promise<void> {
  const successor = argv.includes("--successor");
  const cfg = parseArgs(argv.filter((a) => a !== "--successor"));
  const authDir = cfg.authDir;
  const run = seamRunDir(authDir);
  const journalPath = join(run, "daemon.log");
  const journal = (line: string): void => {
    try {
      mkdirSync(run, { recursive: true, mode: 0o700 });
      try {
        if (statSync(journalPath).size > JOURNAL_MAX) unlinkSync(journalPath);
      } catch {}
      // Метка слова log ([iskron-bridge время]) журналу не нужна: время и сборка — в начале строки.
      const text = line.trimEnd().replace(/\[iskron-bridge [^\]]*\] /, "");
      appendFileSync(
        journalPath,
        `${new Date().toISOString()} pid=${process.pid} ${BUILD} ${text}\n`,
        { mode: 0o600 },
      );
    } catch {} // журнал, который не пишется, не роняет демона
  };
  setProcessLog(journal);
  installCrashWords();

  // Дом против себя — сам, не обёрткой cli: своя сборка новее домашней ложится
  // в дом; домашняя новее — встаёт она преемником, а этот уходит.
  if (!updatesDisabled()) {
    const sync = syncHome();
    for (const p of sync.copied) log(`home updated by this build: ${p}`);
    if (sync.reexec) {
      log(`the home copy is newer — the daemon rises from it: ${sync.reexec}`);
      spawnDaemon(sync.reexec, authDir, successor);
      process.exit(0);
    }
  }

  const sessions = new Map<string, SeamSession>();
  const engines = new Map<string, BridgeSession>();
  /** Сессии, чей тонкий мост сейчас на связи. */
  const attached = new Set<string>();
  /** pid тонкого моста сессии: шов оборван, а мост жив — он в окне переподхвата. */
  const bridgePids = new Map<string, number>();
  const sockets = new Set<Socket>();
  let draining = false;
  let counter = 0;
  let lastNotice: string | null = null;
  let server: Server | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;

  const armIdle = (): void => {
    if (idle) clearTimeout(idle);
    idle = null;
    if (draining || sessions.size) return;
    idle = setTimeout(() => {
      idle = null;
      if (sessions.size || draining) return;
      const flow = pendingFlow();
      if (flow) {
        // Вход ждёт клика человека: колбэк слушает этот процесс — уйти сейчас значило бы потерять вход.
        log("idle, but an authorization flow is pending — staying for the human's click");
        void flow.finally(armIdle);
        return;
      }
      log(`no session for ${Math.round(IDLE_MS / 1000)}s — the daemon leaves`);
      server?.close();
      process.exit(0);
    }, IDLE_MS);
  };

  // Передать места преемнику и уйти (см. заголовок).
  const handover = async (to: string, why: string): Promise<void> => {
    if (draining) return;
    draining = true;
    if (idle) clearTimeout(idle);
    log(`handing over to ${to}: ${why} — ${sessions.size} session(s)`);
    beginHandover(why);
    server?.close(); // новых подключений нет
    // Тонким мостам — слово: ждать преемника, а не поднимать демон самим.
    for (const so of sockets) writeFrame(so, { t: "handover", why });
    spawnDaemon(to, authDir, true); // преемник ждёт, пока этот отпустит вход
    await Promise.allSettled([...sessions.values()].map((s) => s.end(`daemon handover: ${why}`)));
    for (const so of sockets) so.end(); // связь оборвалась — вердикты, переотправка, переподхват
    // Сокеты мест — до вытеснения преемником или до предела (handoff.ts, #6586).
    await handoffsSettled();
    log("handed over — leaving");
    setTimeout(() => process.exit(0), 300);
  };

  // Новее ли копия, чем этот демон: только по версии — между релизами байты
  // различает хеш, а старшинства по хешу нет (разные сборки одной версии живут вместе).
  const newer = (v: string | null): boolean => !!v && compareVersions(v, VERSION) > 0;
  let homeSeen = "";
  const checkHome = (): void => {
    if (draining || updatesDisabled()) return;
    const home = homeBridgePath();
    let stamp: string;
    try {
      const st = statSync(home);
      stamp = `${st.ino}:${st.size}:${st.mtimeMs}`;
    } catch {
      return;
    }
    if (stamp === homeSeen) return;
    homeSeen = stamp;
    const v = versionOfFile(home);
    if (newer(v)) void handover(home, `the home copy is v${v}, this daemon v${VERSION}`);
  };

  // Тонкий мост новее демона — демон поднимается его сборкой: самой новой из
  // домашней копии и файла этого моста. Решение шага 2: сессию он принимает
  // (иначе вызов ждал бы), и тут же передаёт её вместе с остальными.
  const newerBridge = (hello: SeamHello): void => {
    if (updatesDisabled()) return;
    const theirs = /^v(\d+\.\d+\.\d+)/.exec(hello.build)?.[1] ?? null;
    if (!newer(theirs)) return;
    const home = homeBridgePath();
    const homeV = versionOfFile(home);
    const to = homeV && compareVersions(homeV, theirs) >= 0 ? home : hello.path;
    if (!to || !newer(versionOfFile(to))) return;
    setImmediate(() => void handover(to, `a thin bridge ${hello.build} is newer than this daemon`));
  };

  const host: SeamHost = {
    build: BUILD,
    path: SELF,
    log: (m) => log(m),
    count: () => sessions.size,
    draining: () => draining,
    find: (id) => sessions.get(id) ?? null,
    open(hello) {
      const id = `s${++counter}-${process.pid}`;
      let engine: BridgeSession | null = null;
      let s: SeamSession;
      try {
        s = streamSeamSession(
          id,
          (io, logTo) =>
            (engine = openSession(
              io,
              {
                argv: hello.argv,
                env: hello.env ?? {},
                cwd: hello.cwd,
                pid: hello.pid,
                path: hello.path,
                patSha: hello.patSha ?? null,
              },
              { id, log: logTo },
            )),
          (msg) =>
            log(
              `session ${id}: said while no thin bridge was attached — lost: ${JSON.stringify(msg).slice(0, 160)}`,
            ),
          (line) => journal(`[${id}] ${line}`),
        );
      } catch (e) {
        return errorMessage(e);
      }
      const opened = engine as BridgeSession | null;
      const traced: SeamSession = {
        ...s,
        deliver: (msg) => {
          if (process.env.ISKRON_BRIDGE_DAEMON_TRACE)
            journal(`[${id}] rpc ${msg.method ?? "reply"} ${JSON.stringify(msg.id ?? null)}`);
          s.deliver(msg);
        },
        attach: (sink, logSink) => {
          if (sink) attached.add(id);
          else attached.delete(id);
          s.attach(sink, logSink);
        },
        end: (why) => {
          attached.delete(id); // уходящая (bye, окно переподхвата вышло) — уже не на связи
          bridgePids.delete(id);
          return s.end(why).then(() => {
            if (sessions.get(id) !== traced) return;
            sessions.delete(id);
            engines.delete(id);
            log(`session ${id} ended: ${why}`);
            armIdle();
          });
        },
      };
      sessions.set(id, traced);
      bridgePids.set(id, hello.pid);
      if (opened) engines.set(id, opened);
      if (idle) clearTimeout(idle);
      idle = null;
      log(
        `session ${id} for pid ${hello.pid} (${hello.build}, ${hello.path}) argv=${JSON.stringify(hello.argv)}`,
      );
      if (lastNotice && opened?.scope) {
        const notice = lastNotice;
        runIn(opened.scope, () => pendNotice(notice));
      }
      newerBridge(hello);
      return traced;
    },
  };

  const started = Date.now();
  for (;;) {
    try {
      server = await listenSeam(authDir, (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        serveSeam(socket, host, GRACE_MS);
      });
      break;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      // Преемник ждёт, пока уходящий отпустит вход; прочие уходят сразу — демон уже есть.
      if (code === "EADDRINUSE" && successor && Date.now() - started < SUCCESSOR_WAIT_MS) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      log(`the daemon does not rise: ${errorMessage(e)}`);
      process.exit(code === "EADDRINUSE" ? DAEMON_BUSY_EXIT : 3);
    }
  }
  log(`listening ${seamSocketPath(authDir)}${successor ? " (successor)" : ""}`);

  // Процессная часть движка — одна на все сессии; сверка с релизами — своя:
  // отставание говорится каждой сессии, а скачанная свежая копия поднимает преемника.
  startEngine(cfg, { freshness: false });
  startFreshnessWatch(
    authDir,
    cfg.serverUrl,
    (notice) => {
      lastNotice = notice;
      for (const e of engines.values()) if (e.scope) runIn(e.scope, () => tellNotice(notice));
    },
    checkHome,
  );
  const homeTimer = setInterval(checkHome, HOME_CHECK_MS);
  homeTimer.unref();
  checkHome();
  armIdle();

  const stop = (sig: string): void => {
    if (draining) return;
    draining = true;
    log(`${sig} — ending ${sessions.size} session(s)`);
    server?.close();
    // Сессия с тонким мостом на связи — смена держателя, не уход делателя: тонкий мост
    // поднимет новый демон и вернёт место по записи держания, сторож переслушает дверь,
    // сокет места держится до вытеснения новым (handoff.ts, #6485). Так же и мост в окне
    // переподхвата, чей процесс жив: он вернётся к новому демону. Мост умер — отпуск:
    // возвращать некому; умрёт после — место не взято до предела, занятость снимется там.
    for (const id of sessions.keys()) {
      if (!attached.has(id) && !ownPidAlive(bridgePids.get(id))) continue;
      const scope = engines.get(id)?.scope;
      if (scope) runIn(scope, () => beginSessionHandover(`daemon ${sig}`));
    }
    void Promise.allSettled([...sessions.values()].map((s) => s.end(sig)))
      .then(() => {
        for (const so of sockets) so.destroy();
        return handoffsSettled();
      })
      .then(() => process.exit(0));
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

/** Поднять демон этой копией отсоединённо; преемник ждёт, пока уходящий отпустит вход. */
function spawnDaemon(file: string, authDir: string, successor: boolean): void {
  try {
    const child = spawn(
      process.execPath,
      [file, "daemon", "--auth-dir", authDir, ...(successor ? ["--successor"] : [])],
      {
        detached: true,
        stdio: "ignore",
        cwd: seamRunDir(authDir),
        env: process.env,
        windowsHide: true,
      },
    );
    child.on("error", (e) => log(`the successor did not start: ${e.message}`));
    child.unref();
  } catch (e) {
    log(`the successor did not start: ${errorMessage(e)}`);
  }
}
