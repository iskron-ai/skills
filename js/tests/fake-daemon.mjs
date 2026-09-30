#!/usr/bin/env node
// Демон-заглушка для проб тонкого моста (js/tests/thin.test.mjs). Настоящий
// демон машины — следующий шаг; заглушка собрана из тех же частей, что возьмёт
// он: сторона демона на шве (shared/seam-host.ts: listenSeam, serveSeam,
// streamSeamSession) и сессия движка (bridge/session.ts openSession с
// происхождением из рукопожатия) в своём процессе. Хозяин держит сессии по id,
// как демон; движок пока даёт одну на процесс — вторая получает refuse словами
// движка. Сессия ушла — заглушка уходит (у демона это будет окно простоя).
//
// Запуск — тем же ходом, каким тонкий мост поднимает демон
// (ISKRON_BRIDGE_DAEMON_ENTRY=<этот файл>):  node fake-daemon.mjs daemon --auth-dir <dir>
// След для пробы — <auth-dir>/fake-daemon.log: pid, рукопожатия, методы rpc, концы.
// ISKRON_FAKE_DAEMON_CUT=<имя тула>: вызов этого тула режет шов посреди себя
// (сокет рвётся, сессия жива) — тонкий мост переподхватывает её по id.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

import { openSession } from "../bridge/session.ts";
import { seamSocketPath } from "../shared/seam-entrance.ts";
import { listenSeam, serveSeam, streamSeamSession } from "../shared/seam-host.ts";
import { buildOf } from "../shared/version.ts";

const args = process.argv.slice(2);
const authDir = args[args.indexOf("--auth-dir") + 1];
const trail = join(authDir, "fake-daemon.log");
const note = (line) => appendFileSync(trail, `${line}\n`);

const sessions = new Map();
const sockets = new Set();
const cutOn = process.env.ISKRON_FAKE_DAEMON_CUT;
let counter = 0;
const host = {
  build: `${buildOf(import.meta.url)}-fake-daemon`,
  log: (m) => note(`log ${m}`),
  find: (id) => sessions.get(id) ?? null,
  open(hello) {
    const id = `s-${process.pid}-${++counter}`;
    let s;
    try {
      s = streamSeamSession(id, (io) => openSession(io, hello));
    } catch (e) {
      return e.message;
    }
    const traced = {
      ...s,
      deliver: (msg) => {
        note(`rpc ${msg.method ?? "reply"} ${JSON.stringify(msg.id ?? null)}`);
        s.deliver(msg);
        if (cutOn && msg.params?.name === cutOn) {
          setTimeout(() => {
            note(`cut ${JSON.stringify(msg.id)}`);
            for (const so of sockets) so.destroy();
          }, 100);
        }
      },
      end: (why) =>
        s.end(why).then(() => {
          note(`end ${why}`);
          sessions.delete(id);
          if (!sessions.size) setTimeout(() => process.exit(0), 50);
        }),
    };
    sessions.set(id, traced);
    // Что сессия видит от окружения: ключ демона, которого харнес не назвал
    // (снимается), чужое окружение харнеса (не доезжает), токен (не едет по шву).
    note(
      `env stale=${"ISKRON_STALE_MARK" in process.env} harness_other=${"HARNESS_OTHER" in process.env} token_in_hello=${"ISKRON_BRIDGE_TOKEN" in hello.env}`,
    );
    note(
      `hello pid=${hello.pid} session=${hello.session ?? "-"} argv=${JSON.stringify(hello.argv)}`,
    );
    return traced;
  },
};

await listenSeam(authDir, (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  serveSeam(socket, host, 1000);
});
note(`pid ${process.pid} listening ${seamSocketPath(authDir)}`);
process.on("SIGTERM", () => process.exit(0));
