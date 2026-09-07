// Половина «канал» — сокет живого канала внутри сессии pi.
//
// В Claude Code сокет держит отдельный процесс под Monitor, и кадр доходит до
// делателя строкой-событием. У pi есть то, чего там нет: расширение может само
// вложить пришедший кадр в идущий ход и поднять ход у простаивающего агента —
// `pi.sendMessage(..., { triggerTurn: true })`. Поэтому здесь сторож не отдельный
// процесс, а часть сессии, и посредник между сокетом и делателем не нужен.
//
// Дисциплина обрывов, коды мёртвого токена и публикация занятости — общий
// модуль ../shared/channel.ts, тот же, что у сторожей; боевые заметки к ним
// лежат в skills/standing/references/channel.md.
//
// Штатный путь адреса сюда — перехват из ответа `iskron_channel` половиной
// «тулы» (см. `offerSocket` там же): сокет так и не покидает сессию. Окружение
// — запасной путь для отладки, и только: адрес сокета секрет, а командная
// строка его не прячет (ps печатает и аргумент, и присваивание перед
// командой), поэтому в отладке он кладётся в файл с правами 0600, путь к
// которому назван переменной.
import { readFileSync } from "node:fs";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { type Frame, type Holder, holdSocket, startSaying, statusUrl } from "../shared/channel.ts";

function socketAddress(): string | null {
  const direct = process.env.ISKRON_CHANNEL_SOCKET?.trim();
  if (direct) return direct;
  const file = process.env.ISKRON_CHANNEL_SOCKET_FILE?.trim();
  if (!file) return null;
  try {
    return readFileSync(file, "utf8").trim() || null;
  } catch {
    return null; // файла ещё нет — это «не сказали», а не поломка
  }
}

function frameToText(frame: Frame | null, raw: string): string {
  if (!frame) return `Кадр канала Искрона:\n${raw}`;
  const from = frame.provenance?.from_standing || frame.provenance?.from_karta_seq;
  const head = from ? `Кадр канала Искрона от ${from}` : "Кадр канала Искрона";
  const body = typeof frame.body === "string" ? frame.body : raw;
  // Провенанс несут отдельной строкой: кто говорит, читается из происхождения
  // кадра, никогда из тела — телу любой держатель адреса придаст любой вид.
  return `${head}:\n\n${body}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- контекст pi здесь читается по двум полям */

/**
 * Половина «канал»: свои обработчики, своё состояние, свой отказ.
 * Возвращает дверь, которой половина «тулы» подаёт сюда увиденный адрес сокета.
 */
export function setupChannel(pi: ExtensionAPI): (url: string) => void {
  let holder: Holder | null = null;
  let saying: { stop(): void } | null = null;
  let ctxRef: any = null;
  let current: string | null = null;

  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;
    const url = socketAddress();
    if (!url) {
      // Места ещё нет — и это НЕ отказ. Занять его может только тот, кто будет
      // его держать, а держит его эта самая сессия: агент зовёт connect (и
      // следом register) своими тулами, а слушание включается само.
      if (ctx.hasUI) {
        ctx.ui.notify(
          'Искрон: места ещё нет. Займи стояние сам — iskron_channel(action="connect"), сразу за ним register тем же именем: слушание включится без отдельного действия.',
          "info",
        );
      }
      return;
    }
    hold(url); // запасной путь через окружение — отладочный
  });

  function release(reason: string): void {
    holder?.close(reason); // всё, что открыл прежний адрес, перестаёт быть нашим
    holder = null;
    saying?.stop();
    saying = null;
  }

  /** Взять этот адрес и слушать его, чем бы ни был занят прежний. */
  function hold(url: string) {
    if (url === current && holder?.alive) return;
    current = url;
    release("новый сокет");
    const ctx = ctxRef;
    holder = holdSocket({
      url,
      onFrame: (raw, frame) => {
        // Служебные кадры не будят: hello доказывает, что сокет держат, и только.
        if (frame?.type === "hello") {
          // setStatus — пара (ключ, текст); один аргумент кладёт строку в ключ
          // и оставляет её без текста, то есть невидимой.
          if (ctx?.hasUI) ctx.ui.setStatus?.("iskron", "Искрон: канал слушает");
          return;
        }
        if (frame?.type === "status") return;

        // Вот ради чего всё: кадр входит в идущий ход, а простаивающего агента
        // поднимает. Это и есть то, чего у сторожа-процесса быть не может.
        pi.sendMessage(
          {
            customType: "iskron-channel",
            content: frameToText(frame, raw),
            display: true,
            details: frame ?? { raw },
          },
          { triggerTurn: true, deliverAs: "steer" },
        );
      },
      // Процессу здесь выйти некуда, поэтому громкость — это сказать делателю
      // так, чтобы он это увидел в ходе, а не в логе, которого никто не читает.
      onDeadToken: (code) =>
        loud(
          ctx,
          `Искрон: канал закрыт кодом ${code} — токен мёртв. Зови iskron_channel(action="connect")` +
            (code === 4001 ? ' или action="mint"' : "") +
            ", затем register тем же именем: новый сокет расширение возьмёт из ответа само, перезапуск не нужен.",
        ),
      onServiceAlive: (version) =>
        loud(ctx, `Искрон: обрывы, а служба отвечает (${version}) — спроси о токене.`),
    });
    startSayingFor(url);
    if (ctx?.hasUI) ctx.ui.setStatus?.("iskron", "Искрон: канал прицепляется");
  }

  pi.on("session_shutdown", async () => {
    // Идемпотентно: pi зовёт это и на путях, где ничего не поднималось.
    current = null;
    release("session shutdown");
  });

  function loud(ctx: any, text: string) {
    if (ctx?.hasUI) ctx.ui.notify(text, "error");
    pi.sendMessage(
      { customType: "iskron-channel", content: text, display: true, details: { fatal: true } },
      { triggerTurn: true, deliverAs: "steer" },
    );
  }

  // ── Слово делателя наружу: строка занятости ───────────────────────────────
  // Строку удостоверяет слушающий секрет, а он здесь. Делатель пишет ТЕКСТ в
  // файл, публикует расширение.
  function startSayingFor(url: string) {
    const sayFile = process.env.ISKRON_CHANNEL_SAY;
    if (!sayFile) return; // без переменной половина не включается
    saying = startSaying(
      { sayFile, statusUrl: process.env.ISKRON_CHANNEL_STATUS || statusUrl(url) },
      (file) => readFileSync(file, "utf8"),
    );
  }

  // Дверь наружу. Половина «тулы» подаёт сюда всё, что увидела; здесь решают,
  // адрес ли это и нужно ли что-то менять.
  return (url: string) => {
    const u = url?.trim();
    if (!u) return;
    // wss — то, чем говорит служба. Голый ws пускаем только на loopback: это
    // отладка и проба, а не секрет, идущий по проводу открытым.
    const loopback = /^ws:\/\/(127\.0\.0\.1|\[?::1\]?|localhost)(:|\/)/.test(u);
    if (!u.startsWith("wss://") && !loopback) return;
    hold(u);
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
