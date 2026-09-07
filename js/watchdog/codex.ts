// iskron.mjs watchdog-codex [ключ] [--auth-dir <dir>] — сторож для Codex:
// кадр стояния входит в ИДУЩИЙ тред через дверь app-server (граф nks-dev: #4286).
//
// Codex кладёт CODEX_THREAD_ID и CODEX_HOME в окружение команд, которые
// запускает агент, — и только туда (MCP-серверам их нет, потому мост сам
// дверь не найдёт). Значит этот сторож агент запускает из своей оболочки
// фоновой задачей: он читает оба из окружения, прицепляется к локальному
// сокету моста и каждый кадр-сообщение кладёт в тред вызовом turn/start —
// на занятом треде это steer в текущий ход, на простаивающем — новый ход
// (наблюдено: агент ответил на кадр, не дождавшись конца своей команды).
// Мёртвый токен и обрывы при живой службе объявляет ненулевым выходом, как соседи.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { type Door, openDoor } from "../shared/appserver.ts";
import { frameToText } from "../shared/frame-text.ts";
import { attach, parseWatchdogArgs, resolveStanding } from "./client.ts";

const note = (s: string): void => {
  process.stderr.write(s + "\n");
};

export function codexDoorPath(): string {
  const home = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  return join(home, "app-server-control", "app-server-control.sock");
}

export function runWatchdogCodex(argv: string[]): void {
  const threadId = process.env.CODEX_THREAD_ID?.trim();
  if (!threadId) {
    note(
      "ДЕЛАТЕЛЬ: нет CODEX_THREAD_ID — запускай этого сторожа из оболочки сессии Codex: там Codex кладёт id треда в окружение",
    );
    process.exit(2);
  }
  const socketPath = codexDoorPath();
  if (!existsSync(socketPath)) {
    note(
      `ДЕЛАТЕЛЬ: двери нет (${socketPath}) — тред не под демоном app-server. Подними демон (codex app-server daemon start, CODEX_HOME короткий: путь сокета ограничен) или слушай watchdog-exit`,
    );
    process.exit(2);
  }
  const target = resolveStanding(argv);
  if ("error" in target) {
    note(`ДЕЛАТЕЛЬ: ${target.error}`);
    process.exit(2);
  }
  parseWatchdogArgs(argv); // валидность флагов — там же

  let door: Door | null = null;
  let ready: Promise<Door> | null = null;
  let nextId = 1;

  function open(): Promise<Door> {
    if (ready) return ready;
    ready = openDoor(
      socketPath,
      () => {},
      (why) => {
        note(`дверь закрылась: ${why} — открою заново на следующем кадре`);
        door = null;
        ready = null;
      },
    ).then((d) => {
      door = d;
      d.send({
        method: "initialize",
        id: nextId++,
        params: { clientInfo: { name: "iskron-watchdog", title: "iskron", version: "1" } },
      });
      d.send({ method: "initialized" });
      return d;
    });
    ready.catch((e: Error) => {
      note(`дверь не открылась: ${e.message}`);
      ready = null;
    });
    return ready;
  }

  async function deliver(text: string): Promise<void> {
    try {
      const d = door ?? (await open());
      d.send({
        method: "turn/start",
        id: nextId++,
        params: { threadId, input: [{ type: "text", text }], turnTrigger: "iskron-channel" },
      });
      note(`кадр вложен в тред ${threadId}`);
    } catch (e) {
      note(`ДЕЛАТЕЛЬ: кадр не вложился — ${(e as Error).message}`);
    }
  }

  // Мост отдаёт прицепившемуся кольцо последних кадров задним числом — для лога
  // это память, для двери это повторная побудка тем же словом. Кольцо пропускаем:
  // недоставленное за глухоту служба и так пришлёт заново на переподключении.
  let replay = 0;
  attach(target.path, {
    onEvent: (ev) => {
      switch (ev.kind) {
        case "frame": {
          if (replay > 0) {
            replay--;
            return note("кадр из кольца моста — уже был, в тред не кладу");
          }
          const type = ev.frame?.type;
          if (type !== "message") return note(`кадр ${type ?? "не разобран"} — не повод будить`);
          void deliver(frameToText(ev.frame, ev.raw ?? ""));
          break;
        }
        case "dead":
        case "alive":
          note(ev.text ?? "ДЕЛАТЕЛЬ: стояние потеряно");
          void deliver(
            ev.text ?? 'Искрон: стояние потеряно — зови iskron_channel(action="connect")',
          ).then(() => process.exit(1));
          break;
        case "attached":
          replay = ev.buffered ?? 0;
          note(`слушаю стояние ${ev.key}; кадры кладу в тред ${threadId}`);
          break;
        default:
          note(ev.text ?? ev.kind);
      }
    },
    onGone: (why) => {
      note(`ДЕЛАТЕЛЬ: ${why}`);
      process.exit(1);
    },
  });
}
