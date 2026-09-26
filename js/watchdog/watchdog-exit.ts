// iskron.mjs watchdog-exit [ключ] — сторож выхода-на-кадре.
//
// Для харнесов БЕЗ встроенного наблюдателя сокета: там вывод фоновой задачи
// читается только по запросу, и единственное, что харнес превращает в
// прерывание, — конец процесса. Сокет держит мост; этот клиент печатает
// первое настоящее сообщение синхронной записью и ВЫХОДИТ нулём — конец
// процесса и есть доставка. Служебные кадры (hello, пинги) уводит в stderr;
// мёртвый токен и обрывы при живой службе объявляет ненулевым выходом.
import { createHash } from "node:crypto";
import { writeSync } from "node:fs";

import { type ChannelEvent } from "../bridge/hold.ts";
import { batchLine } from "../shared/frame-text.ts";
import { eventKeyOf, noteSeen, seenIds } from "../shared/seen.ts";
import { seenFilePathOf } from "../shared/standings.ts";
import { adoptSeenPath, attach, resolveStanding, staleBatchKeys } from "./client.ts";

// The bridge replays its ring to every client that attaches, so a watchdog
// re-armed after a wake meets the frame it was woken on again. Leaving on it
// woke the doer three times on one frame (graph @nks/nks-dev, node #4469).
// What "already delivered" means is a fact about THIS standing, kept next to
// its socket: the ids this mode has left on. A frame the ring replays that is
// not in it — one that arrived while nobody was attached — still wakes.
// Stale frames never arrive here one by one: the bridge gathers a burst into one
// `stale` event (#4881) — noted as seen and waited past, bodies in the log.

export function frameId(ev: ChannelEvent): string {
  const id = ev.frame?.id;
  return typeof id === "string" && id
    ? id
    : `raw:${createHash("sha256")
        .update(ev.raw ?? "")
        .digest("hex")
        .slice(0, 16)}`;
}

const wake = (s: string): void => {
  writeSync(1, s + "\n"); // делателю: то, что его будит
};
const note = (s: string): void => {
  writeSync(2, s + "\n"); // в лог: то, что будить не должно
};

export function runWatchdogExit(argv: string[]): void {
  const target = resolveStanding(argv);
  if ("error" in target) {
    note(`ДЕЛАТЕЛЬ: ${target.error}`);
    process.exit(2);
  }
  let seenPath = seenFilePathOf(target.authDir, target.key);
  const seen = seenIds(seenPath);
  let woke = false; // отдан хоть один кадр залпа пачки
  let head = ""; // шапка идущей пачки: как прочесть целиком
  const folded: string[] = []; // id свёрнутых адресных слов череды — метятся с её строкой (#6081)
  attach(target.path, {
    onEvent: (ev) => {
      switch (ev.kind) {
        case "frame": {
          const type = ev.frame?.type;
          if (type !== "message") return note(`кадр ${type ?? "не разобран"} — не повод будить`);
          const id = frameId(ev);
          // Пачка кадров комнаты (мост, roomstack.ts) — одна побудка: печатаем её
          // целиком и выходим на последнем кадре залпа, не на первом.
          // Кадр пачки — строкой, без конверта; шапка с указателем «целиком» — перед первым отданным.
          const last = !ev.batch || ev.batch.at >= ev.batch.of;
          if (seen.has(id)) {
            note(`кадр ${id} уже отдан прежним взводом — не повод будить`);
            if (last && woke) process.exit(0);
            return;
          }
          // Адресное слово не мне, свёрнутое в череду (folded), своей строки не печатает.
          if (ev.batch?.folded) {
            folded.push(id);
            return;
          }
          if (ev.batch && head) wake(head);
          head = "";
          // Сперва отдать: запись до побудки при смерти между ними потеряла бы кадр насовсем.
          wake(ev.batch && ev.frame ? batchLine(ev.frame, ev.batch.fold) : (ev.raw ?? ""));
          for (const k of folded.splice(0)) noteSeen(seenPath, k, seen);
          noteSeen(seenPath, id, seen);
          const evKey = eventKeyOf(ev.frame);
          if (evKey) noteSeen(seenPath, evKey, seen); // событие графа отдано — другие копии веера тоже
          woke = true;
          if (last) process.exit(0); // конец процесса И ЕСТЬ доставка
          break;
        }
        case "stale":
          // Пачка лежалых: не повод будить, но и не потеря — тела в логе, id помечены.
          for (const k of staleBatchKeys(ev)) noteSeen(seenPath, k, seen);
          note(ev.text ?? "лежалые кадры");
          break;
        case "dead":
        case "alive":
        case "evicted":
          note(ev.text ?? "ДЕЛАТЕЛЬ: стояние потеряно");
          process.exit(1);
          break;
        case "attached":
          seenPath = adoptSeenPath(ev.seen, seenPath, seen); // память места на его сервере
          note(`слушаю стояние ${ev.key}`);
          break;
        default:
          if (ev.kind === "note" && ev.batch) head = ev.text ?? ""; // шапка пачки — делателю, с её первым кадром
          note(ev.text ?? ev.kind);
      }
    },
    onGone: (why) => {
      note(`ДЕЛАТЕЛЬ: ${why}`);
      process.exit(1);
    },
  });
}
