// iskron.mjs watchdog [ключ] — сторож под наблюдателем харнеса.
//
// Сокет стояния держит мост (см. ../bridge/hold.ts); этот процесс — его
// локальный клиент: печатает каждый кадр на stdout (под Monitor с
// persistent: true каждая строка приходит событием в ход делателя), а на
// мёртвом токене и на обрывах при живой службе выходит ненулевым — громко,
// как и прежде. Секрета у него нет и аргумент ему не нужен, когда мост держит
// одно стояние; ключ из ответа connect различает несколько.
import { writeSync } from "node:fs";

import { frameToText } from "../shared/frame-text.ts";
import { attach, resolveStanding } from "./client.ts";

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

const log = (s: string): void => {
  process.stdout.write(s + "\n");
};

// Последнее слово перед выходом: синхронно, иначе выход следом уносит саму строку.
const loudExit = (s: string, code: number): void => {
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
  attach(target.path, {
    onEvent: (ev) => {
      switch (ev.kind) {
        case "attached":
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
          for (const line of wrapLines(frameToText(f, ev.raw ?? ""))) log(line);
          break;
        }
        case "note":
          log(ev.text ?? "");
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
