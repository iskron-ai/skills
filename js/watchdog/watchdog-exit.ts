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
import { noteSeen, seenIds } from "../shared/seen.ts";
import { seenFilePathOf } from "../shared/standings.ts";
import { attach, resolveStanding } from "./client.ts";

// The bridge replays its ring to every client that attaches, so a watchdog
// re-armed after a wake meets the frame it was woken on again. Leaving on it
// woke the doer three times on one frame (graph @nks/nks-dev, node #4469).
// What "already delivered" means is a fact about THIS standing, kept next to
// its socket: the ids this mode has left on. A frame the ring replays that is
// not in it — one that arrived while nobody was attached — still wakes.
// A replay the SERVICE makes after a session rebuild comes under new ids with
// `stale: true` (#4881): stale is not a wake either — noted and waited past.

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
  const seenPath = seenFilePathOf(target.authDir, target.key);
  const seen = seenIds(seenPath);
  attach(target.path, {
    onEvent: (ev) => {
      switch (ev.kind) {
        case "frame": {
          const type = ev.frame?.type;
          if (type !== "message") return note(`кадр ${type ?? "не разобран"} — не повод будить`);
          const id = frameId(ev);
          if (seen.has(id)) return note(`кадр ${id} уже отдан прежним взводом — не повод будить`);
          if (ev.frame?.stale === true) {
            noteSeen(seenPath, id, seen);
            return note(`кадр ${id} лежалый (stale) — повтор службы, не повод будить`);
          }
          wake(ev.raw ?? ""); // сперва отдать: запись до побудки при смерти между ними потеряла бы кадр насовсем
          noteSeen(seenPath, id, seen);
          process.exit(0); // конец процесса И ЕСТЬ доставка
          break;
        }
        case "dead":
        case "alive":
        case "evicted":
          note(ev.text ?? "ДЕЛАТЕЛЬ: стояние потеряно");
          process.exit(1);
          break;
        case "attached":
          note(`слушаю стояние ${ev.key}`);
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
