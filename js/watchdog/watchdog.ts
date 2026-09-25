// iskron.mjs watchdog [ключ] — сторож под наблюдателем харнеса.
//
// Сокет стояния держит мост (см. ../bridge/hold.ts); этот процесс — его
// локальный клиент: печатает каждый кадр на stdout (под Monitor каждая
// строка приходит событием в ход делателя), а на
// мёртвом токене и на обрывах при живой службе выходит ненулевым — громко,
// как и прежде. Секрета у него нет и аргумент ему не нужен, когда мост держит
// одно стояние; ключ из ответа connect различает несколько.
import { writeSync } from "node:fs";

import { batchLine, frameToText } from "../shared/frame-text.ts";
import { deliveredKeys, noteSeen, seenIds } from "../shared/seen.ts";
import { seenFilePathOf } from "../shared/standings.ts";
import { adoptSeenPath, attach, resolveStanding, staleBatchKeys } from "./client.ts";

// Monitor Claude Code режет строку события длиннее ~500 знаков (наблюдено:
// «...(truncated)»), а строки в одном залпе склеивает в одно событие целиком.
// Кадр-сообщение идёт тем же текстом, что в pi и OpenCode (кто говорит,
// провенанс, конверт, тело), телом построчно (граф nks-dev: #5011, #5033).
const LINE_MAX = 400;

export function wrapLines(text: string, max = LINE_MAX): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    let rest = line;
    while ([...rest].length > max) {
      const head = [...rest].slice(0, max).join("");
      const cut = head.lastIndexOf(" ");
      const at = cut > max / 2 ? cut : head.length;
      out.push(rest.slice(0, at).trimEnd());
      rest = rest.slice(at).trimStart();
    }
    out.push(rest);
  }
  return out;
}

const plural = (n: number): string => {
  const m10 = n % 10;
  const m100 = n % 100;
  const word =
    m10 === 1 && m100 !== 11
      ? "кадр"
      : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)
        ? "кадра"
        : "кадров";
  return `${n} ${word}`;
};

// Monitor склеивает строки, пришедшие в пределах ~200 мс, в одно событие и режет
// его по длине: кадр вне пачки (слово человека, прерывающий, прямой) печатается
// отдельным событием — с паузой больше окна склейки до себя и после себя.
// Переменная — шов для проб, не ручка человека: очередь в сотни кадров идёт по паузе на кадр.
const ALONE_GAP_MS = Number(process.env.ISKRON_WATCHDOG_ALONE_MS) || 300;
let queue: Promise<void> = Promise.resolve();
let lastAt = 0;
let lastAlone = false;

/**
 * Блок строк одной записью; alone — отдельным событием Monitor. after — когда
 * запись ушла (колбэк write), не когда вызвана: пометка .seen — после отдачи.
 */
const out = (lines: string[], alone = false, after?: () => void): void => {
  queue = queue.then(async () => {
    const wait = lastAt && (alone || lastAlone) ? lastAt + ALONE_GAP_MS - Date.now() : 0;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const failed = await new Promise<boolean>((r) =>
      process.stdout.write(lines.join("\n") + "\n", (e) => r(!!e)),
    );
    lastAt = Date.now();
    lastAlone = alone;
    if (!failed) after?.(); // не ушла — не отдана: перевзвод отдаст снова
  });
};

const log = (s: string): void => out([s]);

// Последнее слово перед выходом: синхронно, иначе выход следом уносит саму строку;
// выход ждёт опустевшей очереди: всё поставленное до него уже записано.
const loudExit = (s: string, code: number): void => {
  queue = queue.then(() => exitNow(s, code));
};
const exitNow = (s: string, code: number): void => {
  try {
    writeSync(1, s + "\n");
    process.exit(code);
  } catch {
    process.stdout.write(s + "\n", () => process.exit(code));
    setTimeout(() => process.exit(code), 1000).unref();
  }
};

export function runWatchdog(argv: string[]): void {
  const target = resolveStanding(argv);
  if ("error" in target) {
    writeSync(2, `ДЕЛАТЕЛЬ: ${target.error}\n`);
    process.exit(2);
  }
  // Напечатанный кадр — отданный: пометка его, а не записи моста, держит перевзвод от повтора.
  let seenPath = seenFilePathOf(target.authDir, target.key);
  const seen = seenIds(seenPath);
  const queued = new Set<string>(); // id в очереди печати: пометка ляжет после неё
  attach(target.path, {
    onEvent: (ev) => {
      switch (ev.kind) {
        case "attached":
          seenPath = adoptSeenPath(ev.seen, seenPath, seen); // память места на его сервере
          log(
            `слушаю стояние ${ev.key}${ev.buffered ? ` (${plural(ev.buffered)} задним числом)` : ""}`,
          );
          break;
        case "frame": {
          const f = ev.frame;
          if (f?.type !== "message") {
            log(ev.raw ?? ""); // служебный кадр (hello, статус) короток и печатается как есть
            break;
          }
          // Повтор уже напечатанного или ждущего печати (тот же id) — вторая линия за мостом: не печатается (#5831).
          const id = typeof f.id === "string" ? f.id : "";
          const again = !!id && (seen.has(id) || queued.has(id));
          if (id && !again) queued.add(id);
          const mark = (): void => {
            for (const k of deliveredKeys(f)) noteSeen(seenPath, k, seen); // после печати
            queued.delete(id);
          };
          if (ev.batch) {
            // Пачка дела — по строке на кадр, без конверта; как прочесть целиком — в шапке.
            if (!again) out(wrapLines(batchLine(f)), false, mark);
            break;
          }
          if (!again) out(wrapLines(frameToText(f, ev.raw ?? "")), true, mark);
          break;
        }
        case "note":
          log(ev.text ?? "");
          break;
        case "stale":
          // Одна пачка — одно событие. Напечатана — отдана, и названное числом сверх показанного тоже.
          out(wrapLines(ev.text ?? ""), false, () => {
            for (const k of staleBatchKeys(ev)) noteSeen(seenPath, k, seen);
          });
          break;
        case "dead":
        case "evicted":
          loudExit(ev.text ?? "ДЕЛАТЕЛЬ: стояние потеряно", 1);
          break;
        case "alive":
          log(ev.text ?? "ДЕЛАТЕЛЬ: сокет рвут, а служба отвечает — мост держит место"); // держание идёт, сторож слушает дальше
          break;
        case "released":
          log(`мост отпустил сокет: ${ev.text ?? ""}`);
          break;
      }
    },
    onGone: (why) => loudExit(`ДЕЛАТЕЛЬ: ${why}`, 1),
  });
}
