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
import { addressedToMine } from "../shared/addressed.ts";
import { type Frame } from "../shared/channel.ts";
import { batchLine, caseKey, frameToText } from "../shared/frame-text.ts";
import { deliveryKeys, noteSeen, seenIds } from "../shared/seen.ts";
import { seenFilePathOf } from "../shared/standings.ts";
import { adoptSeenPath, attach, heldHeads, resolveStanding } from "./client.ts";
import { doer, wd } from "./words.ts";

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
    note(doer(target.error));
    process.exit(2);
  }
  let seenPath = seenFilePathOf(target.authDir, target.key);
  const seen = seenIds(seenPath);
  let head = false; // шапка идущей пачки ждёт её последнего кадра
  let fresh = false; // в идущей пачке есть не отданный прежде кадр
  let block: { lines: string[]; shown: Frame[]; ids: string[] } = { lines: [], shown: [], ids: [] };
  const folded: string[] = []; // id свёрнутых адресных слов череды — метятся с её строкой (#6081)
  const cases = new Set<string>(); // дела, уже названные зачином в идущей пачке
  // Пачка из одних счётов (#6574) не будит: шапка ждёт ближайшей побудки, id —
  // её пометки; со смертью сторожа неотданное придёт кольцом моста снова.
  let batch: Frame[] = []; // кадры идущей пачки — её счёт, если она не разбудила
  const riders: Frame[][] = []; // пачки из одних счётов — кадрами до побудки (heldHeads)
  const riderIds: string[] = [];
  const hold = (): void => {
    if (head) riders.push(batch);
    riders.splice(0, Math.max(0, riders.length - 100)); // старшие уходят: счёт не копится без меры
    head = false;
  };
  attach(target.path, {
    onEvent: (ev) => {
      switch (ev.kind) {
        case "frame": {
          const type = ev.frame?.type;
          if (type !== "message") return note(wd.notWakeup(type));
          const id = frameId(ev);
          const f = ev.frame ?? null;
          const has = (k: string): boolean => seen.has(k);
          // Сперва отдать, затем пометить напечатанное — с событием, если оно вошло текстом
          // (seen.ts deliveryKeys); выход И ЕСТЬ доставка. Запись до побудки при смерти между
          // ними потеряла бы кадр насовсем.
          const deliver = (
            groups: Frame[][],
            lines: string[],
            shown: Frame[],
            ids: string[],
          ): never => {
            for (const s of [...heldHeads(groups, has, shown), ...lines]) wake(s);
            const keys = [...riderIds.splice(0), ...ids, ...shown.flatMap((s) => deliveryKeys(s))];
            for (const k of keys) noteSeen(seenPath, k, seen);
            process.exit(0);
          };
          if (!ev.batch) {
            if (seen.has(id)) return note(wd.seenEarlier(id));
            return deliver(
              riders.splice(0),
              [f ? frameToText(f, ev.raw ?? "") : (ev.raw ?? "")],
              f ? [f] : [],
              [id],
            );
          }
          // Пачка кадров комнаты (мост, roomstack.ts) — одна побудка: печатается блоком на
          // последнем кадре залпа — шапка по всем её кадрам (#6574), строки только адресованным
          // месту. Пачка без адресованных не будит: её шапка ждёт ближайшей побудки.
          if (ev.batch.at === 1) {
            batch = [];
            cases.clear(); // зачин дела — у первой его строки в пачке
            block = { lines: [], shown: [], ids: [] };
            fresh = false;
          }
          if (f) batch.push(f);
          if (seen.has(id)) note(wd.seenEarlier(id));
          else {
            fresh = true;
            if (ev.batch.folded) folded.push(id);
            else if (!f || !addressedToMine(f)) riderIds.push(id, ...folded.splice(0));
            else {
              const first = !cases.has(caseKey(f));
              cases.add(caseKey(f));
              block.lines.push(batchLine(f, ev.batch.fold, first));
              block.shown.push(f);
              block.ids.push(id, ...folded.splice(0));
            }
          }
          if (ev.batch.at < ev.batch.of) return;
          if (!fresh) head = false; // пачка из одних отданных — повтор: в ждущий счёт не встаёт
          if (!block.lines.length) {
            hold();
            return note(wd.unaddressed());
          }
          const groups = [...riders.splice(0), ...(head ? [batch] : [])];
          head = false;
          return deliver(groups, block.lines, block.shown, block.ids);
        }
        case "stale":
          // Пачка лежалых: не повод будить, но и не потеря — тела в логе, метки пачки помечены.
          for (const k of ev.marks ?? []) noteSeen(seenPath, k, seen);
          note(ev.text ?? wd.staleFrames());
          break;
        case "dead":
        case "alive":
        case "evicted":
          note(ev.text ?? wd.seatLost());
          process.exit(1);
          break;
        case "attached":
          seenPath = adoptSeenPath(ev.seen, seenPath, seen); // память места на его сервере
          note(wd.listening(ev.key));
          break;
        case "released":
          note(wd.bridgeReleasedSocket(ev.text ?? ""));
          if (ev.own) process.exit(0); // своё close/revoke — не уход моста (#6638)
          break;
        default:
          if (ev.kind === "note" && ev.batch) head = true; // шапка пачки — её кадрами, с её первым кадром
          note(ev.text ?? ev.kind);
      }
    },
    onGone: (why) => {
      note(doer(why));
      process.exit(1);
    },
  });
}
