// iskron.mjs watchdog <адрес-сокета> — сторож канала под наблюдателем харнеса.
// Адрес — секрет, и командная строка его не прячет: ps печатает и аргумент, и
// присваивание перед командой. Клади адрес в файл 0600 и разворачивай внутри
// команды: bash -c 'ISKRON_CHANNEL_SOCKET=$(cat <файл>) exec node iskron.mjs watchdog'
// — сторож читает переменную, когда аргумента нет.
//
// Держит сокет канала делателя открытым и доставляет каждый кадр: печатает его
// на stdout, переоткрывается по закрытию, отличает мёртвый токен от катящейся
// выкатки и на мёртвом токене выходит ненулевым. В Claude Code гони его под
// Monitor с persistent: true — каждая напечатанная строка придёт событием в
// ход делателя. На харнесе без встроенного наблюдателя нужен не он, а
// `watchdog-exit` рядом: выход на первом кадре-сообщении вместо печати.
//
// И он же несёт слово делателя НАРУЖУ — строку занятости, вторая половина.
// Дисциплина обрывов и публикации — в ../shared/channel.ts, одна на всех
// держателей; боевые заметки — в skills/standing/references/channel.md.
import { readFileSync, writeSync } from "node:fs";

import { deadTokenAdvice, holdSocket, startSaying, statusUrl } from "../shared/channel.ts";

const log = (s: string): void => {
  process.stdout.write(s + "\n");
};

// Последнее слово перед выходом: синхронно, иначе выход следом уносит саму строку.
// Полная неблокирующая труба бросает EAGAIN — тогда обычная печать и выход по её
// колбэку; сторожевой таймер на случай, если читатель не заберёт вовсе.
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
  const url = argv[0] || process.env.ISKRON_CHANNEL_SOCKET;
  if (!url) {
    writeSync(2, "нужен адрес сокета: iskron.mjs watchdog <wss://…> или ISKRON_CHANNEL_SOCKET\n");
    process.exit(2);
  }

  holdSocket({
    url,
    onFrame: (raw) => log(raw),
    // Нулевой выход был бы неотличим от чистой остановки, а молчаливый — от
    // работающего сторожа: оба конца пути отсюда громкие.
    onDeadToken: (code) => loudExit(`ДЕЛАТЕЛЬ: ${deadTokenAdvice(code)}`, 1),
    onServiceAlive: (version) =>
      loudExit(`ДЕЛАТЕЛЬ: обрывы, а служба отвечает (${version}) — спроси о токене`, 1),
    onNote: log,
  });

  // ── Вторая половина: слово делателя наружу ─────────────────────────────────
  // Без переменной половина не включается, и старое поведение сохраняется дословно.
  const sayFile = process.env.ISKRON_CHANNEL_SAY;
  if (sayFile) {
    startSaying(
      {
        sayFile,
        // Выданный рядом с сокетом адрес — первый; вывод из формы — фолбэк.
        statusUrl: process.env.ISKRON_CHANNEL_STATUS || statusUrl(url),
        onRefused: (_text, status) =>
          log(`ДЕЛАТЕЛЬ: строку занятости не приняли (${status ?? "нет ответа"}) — см. channel.md`),
      },
      (file) => readFileSync(file, "utf8"),
    );
  }
}
