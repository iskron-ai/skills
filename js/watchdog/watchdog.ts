// iskron.mjs watchdog [ключ] — сторож под наблюдателем харнеса.
//
// Сокет стояния держит мост (см. ../bridge/hold.ts); этот процесс — его
// локальный клиент: печатает каждый кадр на stdout (под Monitor каждая
// строка приходит событием в ход делателя), а на
// мёртвом токене и на обрывах при живой службе выходит ненулевым — громко,
// как и прежде. Секрета у него нет и аргумент ему не нужен, когда мост держит
// одно стояние; ключ из ответа connect различает несколько.
import { writeSync } from "node:fs";

import { addressedToMine } from "../shared/addressed.ts";
import { type Frame } from "../shared/channel.ts";
import { batchLine, caseKey, frameToText } from "../shared/frame-text.ts";
import { L } from "../shared/lang.ts";
import { deliveredKeys, noteSeen, seenIds, staleBatchKeys } from "../shared/seen.ts";
import { seenFilePathOf } from "../shared/standings.ts";
import { adoptSeenPath, attach, dropHeldCopies, heldHeads, resolveStanding } from "./client.ts";
import { doer, wd } from "./words.ts";

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
  const form =
    m10 === 1 && m100 !== 11 ? 0 : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 1 : 2;
  return `${n} ${L(["кадр", "кадра", "кадров"][form], n === 1 ? "frame" : "frames")}`;
};

// Monitor склеивает строки, пришедшие в пределах ~200 мс, в одно событие и режет
// его по длине: кадр вне пачки (слово человека, прерывающий, прямой) печатается
// отдельным событием — с паузой больше окна склейки до себя и после себя.
// Переменная — шов для проб, не ручка человека: очередь в сотни кадров идёт по паузе на кадр.
const ALONE_GAP_MS = Number(process.env.ISKRON_WATCHDOG_ALONE_MS) || 300;
/** Сколько шапок пачек из одних счётов ждёт адресованного, не больше. */
const RIDERS_MAX = 100;
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
    writeSync(2, `${doer(target.error)}\n`);
    process.exit(2);
  }
  // Напечатанный кадр — отданный: пометка его, а не записи моста, держит перевзвод от повтора.
  let seenPath = seenFilePathOf(target.authDir, target.key);
  const seen = seenIds(seenPath);
  const queued = new Set<string>(); // id в очереди печати: пометка ляжет после неё
  const folded: (() => void)[] = []; // пометки свёрнутых слов череды — после её строки
  const cases = new Set<string>(); // дела, уже названные зачином в идущей пачке
  // Под Monitor строка stdout будит ход: пачка из одних счётов (#6574) не
  // печатается сама — её шапка ждёт и уходит перед ближайшей адресованной строкой.
  let head = ""; // шапка идущей пачки — до её первой адресованной строки
  let fresh = false; // в идущей пачке есть не отданный прежде кадр
  let batch: Frame[] = []; // кадры идущей пачки — её счёт, если адресованных в ней нет
  const riders: Frame[][] = []; // пачки из одних счётов — кадрами до печати (heldHeads)
  const riderMarks: (() => void)[] = []; // их пометки — после печати
  const hold = (): void => {
    if (head) riders.push(batch);
    riders.splice(0, Math.max(0, riders.length - RIDERS_MAX)); // старшие уходят: счёт не копится без меры
    head = "";
  };
  /** Ждущие шапки и шапка идущей пачки — строками перед адресованным; пометки — после печати. */
  const take = (carrier: Frame): { lines: string[]; marks: (() => void)[] } => {
    const lines = [...heldHeads(riders, carrier), ...(head ? [head] : [])];
    head = "";
    return { lines, marks: riderMarks.splice(0) };
  };
  attach(target.path, {
    onEvent: (ev) => {
      switch (ev.kind) {
        case "attached":
          seenPath = adoptSeenPath(ev.seen, seenPath, seen); // память места на его сервере
          log(wd.listening(ev.key, ev.buffered ? wd.backfilled(plural(ev.buffered)) : ""));
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
            // Пачка дела — счётом по делам в шапке (#6574); строка ниже — только
            // адресованному месту. Адресное слово не мне, свёрнутое в череду
            // (folded), своей строки не печатает: метится вместе со строкой
            // череды, которая его считает (#6081); неадресованное — метится
            // сразу: шапка назвала его числом.
            if (ev.batch.at === 1) {
              cases.clear(); // зачин дела — у первой его строки в пачке
              fresh = false;
              batch = [];
            }
            batch.push(f);
            if (!again) fresh = true;
            const last = ev.batch.at >= ev.batch.of;
            // Пачка из одних отданных — повтор: её шапка уже ушла и в ждущий счёт не встаёт.
            if (last && !fresh) head = "";
            if (ev.batch.folded) {
              if (!again) folded.push(mark);
              if (last) hold();
              break;
            }
            const within = folded.splice(0);
            const all = (): void => [...within, mark].forEach((m) => m());
            if (!addressedToMine(f)) {
              riderMarks.push(all);
              if (last) hold();
              break;
            }
            const first = !cases.has(caseKey(f));
            cases.add(caseKey(f));
            if (!again) {
              const r = take(f);
              out([...r.lines, ...wrapLines(batchLine(f, ev.batch.fold, first))], false, () =>
                [...r.marks, all].forEach((m) => m()),
              );
            } else all();
            if (last) hold();
            break;
          }
          if (!again) {
            const r = take(f);
            if (r.lines.length) out(r.lines, false, () => r.marks.forEach((m) => m()));
            out(wrapLines(frameToText(f, ev.raw ?? "")), true, mark);
          }
          break;
        }
        case "note":
          if (ev.batch)
            head = ev.text ?? ""; // шапка пачки — с её первой адресованной строкой
          else log(ev.text ?? "");
          break;
        case "stale":
          // Одна пачка — одно событие. Напечатана — отдана, и названное числом сверх показанного тоже.
          dropHeldCopies(riders, ev.frames ?? []); // её события ждущий счёт не повторит
          out(wrapLines(ev.text ?? ""), false, () => {
            for (const k of staleBatchKeys(ev)) noteSeen(seenPath, k, seen);
          });
          break;
        case "dead":
        case "evicted":
          loudExit(ev.text ?? wd.seatLost(), 1);
          break;
        case "alive":
          log(ev.text ?? wd.aliveNote()); // держание идёт, сторож слушает дальше
          break;
        case "released":
          // Своё close/revoke — последнее слово сторожа, без тревоги и ненулевого кода (#6638).
          if (ev.own) loudExit(wd.bridgeReleasedSocket(ev.text ?? ""), 0);
          else log(wd.bridgeReleasedSocket(ev.text ?? ""));
          break;
      }
    },
    onGone: (why) => loudExit(doer(why), 1),
  });
}
