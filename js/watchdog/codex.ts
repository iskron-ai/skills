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

import { type ChannelEvent } from "../bridge/hold.ts";
import { addressedToMine } from "../shared/addressed.ts";
import { type Door, openDoor } from "../shared/appserver.ts";
import { frameToText } from "../shared/frame-text.ts";
import { deliveryKeys, noteSeen, seenIds } from "../shared/seen.ts";
import { staleBatch } from "../shared/stalebatch.ts";
import { seenFilePathOf } from "../shared/standings.ts";
import { adoptSeenPath, attach, heldHeads, parseWatchdogArgs, resolveStanding } from "./client.ts";
import { doer, wd } from "./words.ts";

const FLUSH_WAIT_MS = 5000; // своё отпускание ждёт вложений в полёте не дольше

const note = (s: string): void => {
  process.stderr.write(s + "\n");
};

export function codexDoorPath(): string {
  const home = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  return join(home, "app-server-control", "app-server-control.sock");
}

export function runWatchdogCodex(argv: string[]): void {
  parseWatchdogArgs(argv); // язык от моста — до первого слова делателю
  const threadId = process.env.CODEX_THREAD_ID?.trim();
  if (!threadId) {
    note(wd.noThread());
    process.exit(2);
  }
  const socketPath = codexDoorPath();
  if (!existsSync(socketPath)) {
    note(wd.noDoor(socketPath));
    process.exit(2);
  }
  const target = resolveStanding(argv);
  if ("error" in target) {
    note(doer(target.error));
    process.exit(2);
  }
  let seenPath = seenFilePathOf(target.authDir, target.key);
  const seen = seenIds(seenPath);
  const waiting = new Map<number, string[]>(); // id запроса turn/start → id кадров, ждущих подтверждения

  let door: Door | null = null;
  let ready: Promise<Door> | null = null;
  let nextId = 1;

  function open(): Promise<Door> {
    if (ready) return ready;
    ready = openDoor(
      socketPath,
      (m) => {
        // Доставлен кадр, когда тред ПРИНЯЛ turn/start, — не когда запрос ушёл (#5428).
        // Встречный запрос демона (есть method) — не ответ, даже при совпавшем id.
        const ids = !m?.method && typeof m?.id === "number" ? waiting.get(m.id) : undefined;
        if (!ids) return;
        waiting.delete(m.id);
        if (m.error) return note(wd.threadRefused(m.error.message ?? wd.refusal()));
        note(wd.framePut(threadId));
        for (const id of ids) noteSeen(seenPath, id, seen);
      },
      (why) => {
        const lost = [...waiting.values()].flat();
        waiting.clear();
        note(wd.doorClosed(why, lost));
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
      note(wd.doorNotOpened(e.message));
      ready = null;
    });
    return ready;
  }

  // Вложения в полёте: своё отпускание ждёт их, прежде чем выйти (#6638).
  const inFlight = new Set<Promise<void>>();
  function deliver(text: string, ids: string[] = []): Promise<void> {
    const p = put(text, ids).finally(() => inFlight.delete(p));
    inFlight.add(p);
    return p;
  }
  async function put(text: string, ids: string[]): Promise<void> {
    try {
      const d = door ?? (await open());
      const reqId = nextId++;
      waiting.set(reqId, ids);
      d.send({
        method: "turn/start",
        id: reqId,
        params: { threadId, input: [{ type: "text", text }], turnTrigger: "iskron-channel" },
      });
      note(wd.frameSent(threadId));
    } catch (e) {
      note(wd.frameNotPut((e as Error).message));
    }
  }

  // Мост отдаёт из кольца задним числом только то, что никто не доставил (#5428),
  // — это кадры, пришедшие между взводами: их вкладываем, как живые. Кадр без id
  // пометить нечем, и из кольца он пришёл бы на каждом взводе — такой пропускаем.
  let replay = 0;
  // Неадресованные месту записи дел (#6574) копятся и хода не начинают: счётом
  // по делам они едут шапкой с ближайшим кадром в тред; текст их в тред не идёт.
  let pend: { frame: NonNullable<ChannelEvent["frame"]>; ids: string[] }[] = [];
  /**
   * Ждущий счёт — шапкой впереди `text`, составленной в миг вложения: по памяти сторожа
   * и меткам ходов, уже ушедших в тред и ждущих принятия (seen.ts eventIn, client.ts heldHeads).
   */
  const withPend = (text: string, ids: string[], carrier?: ChannelEvent["frame"]): void => {
    const got = pend;
    pend = [];
    const sent = new Set([...waiting.values()].flat());
    const head = heldHeads(
      [got.map((g) => g.frame)],
      (k) => seen.has(k) || sent.has(k),
      carrier ? [carrier] : [],
    );
    void deliver([...head, ...(text ? [text] : [])].join("\n"), [
      ...got.flatMap((g) => g.ids),
      ...ids,
    ]);
  };
  attach(target.path, {
    onEvent: (ev) => {
      switch (ev.kind) {
        case "frame": {
          const fromRing = replay > 0;
          if (fromRing) replay--;
          const type = ev.frame?.type;
          if (type !== "message") return note(wd.notWakeup(type));
          if (fromRing && typeof ev.frame?.id !== "string") return note(wd.noIdFromRing());
          // Повтор уже вложенного (тот же id) — вторая линия за мостом (#5831).
          if (typeof ev.frame?.id === "string" && seen.has(ev.frame.id))
            return note(wd.alreadyPut(ev.frame.id));
          // Неадресованное месту — числом: копится, строка не кладётся (#6574).
          if (ev.batch && ev.frame && !addressedToMine(ev.frame)) {
            pend.push({ frame: ev.frame, ids: deliveryKeys(ev.frame) });
            pend.splice(0, Math.max(0, pend.length - 500)); // старшие уходят: счёт ждёт, не копится без меры
            return;
          }
          // Накопленное — шапкой впереди; кадр идёт текстом — метки по принятию тредом.
          withPend(frameToText(ev.frame, ev.raw ?? ""), deliveryKeys(ev.frame), ev.frame);
          break;
        }
        case "stale": {
          // Одна пачка — один ход, судится в миг вложения (shared/stalebatch.ts): по памяти
          // сторожа и меткам ходов, уже ушедших в тред; метки пачки — по принятию тредом.
          const sent = new Set([...waiting.values()].flat());
          const b = staleBatch(ev.frames ?? [], (k) => seen.has(k) || sent.has(k));
          if (b.text) void deliver(b.text, b.keys);
          else for (const k of b.keys) noteSeen(seenPath, k, seen);
          break;
        }
        case "dead":
        case "evicted":
          note(ev.text ?? wd.seatLost());
          void deliver(ev.text ?? wd.codexLost()).then(() => process.exit(1));
          break;
        case "alive":
          note(ev.text ?? wd.aliveNote());
          void deliver(ev.text ?? wd.codexAlive()); // держание идёт, сторож слушает дальше
          break;
        case "attached":
          replay = ev.buffered ?? 0;
          seenPath = adoptSeenPath(ev.seen, seenPath, seen); // память места на его сервере
          note(wd.listeningCodex(ev.key, threadId));
          break;
        case "released":
          note(wd.bridgeReleasedSocket(ev.text ?? ""));
          // Своё close/revoke/leave — не уход моста: последние кадры и ждавший счёт — в тред, затем выход (#6638).
          if (!ev.own) break;
          if (pend.length) withPend("", []);
          // Дверь, не ответившая на upgrade, держала бы сторожа вечно: предел и громкий выход.
          setTimeout(() => {
            note(wd.flushNotPut(FLUSH_WAIT_MS / 1000));
            process.exit(1);
          }, FLUSH_WAIT_MS);
          void Promise.allSettled([...inFlight]).then(() => process.exit(0));
          break;
        default:
          note(ev.text ?? ev.kind);
      }
    },
    onGone: (why) => {
      note(doer(why));
      process.exit(1);
    },
  });
}
