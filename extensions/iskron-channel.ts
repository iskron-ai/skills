// Сторож канала Искрона, живущий ВНУТРИ сессии pi.
//
// В Claude Code сокет держит отдельный процесс под Monitor, и кадр доходит до
// делателя строкой-событием. У pi есть то, чего там нет: расширение может само
// вложить пришедший кадр в идущий ход и поднять ход у простаивающего агента —
// `pi.sendMessage(..., { triggerTurn: true })`. Поэтому здесь сторож не отдельный
// процесс, а часть сессии, и посредник между сокетом и делателем не нужен.
//
// Дисциплина обрывов, коды мёртвого токена и публикация занятости перенесены из
// skills/standing/references/watchdog.mjs — они выведены полем, а не выдуманы
// здесь; боевые заметки к ним лежат в skills/standing/references/channel.md.
//
// Адрес сокета — секрет. Командная строка его не прячет (ps печатает и аргумент,
// и присваивание перед командой), поэтому адрес берётся из окружения или из файла
// с правами 0600, путь к которому назван окружением.
import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEAD_TOKEN = [4000, 4001, 4002];
const ROLLOUT = 4003;

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

export default function (pi: ExtensionAPI) {
  // Фабрика не поднимает ничего живого: pi зовёт её и в вызовах, где сессии не
  // будет вовсе. Сокет, таймеры и всё прочее — только с session_start.
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sayTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let fastDrops = 0;

  pi.on("session_start", async (_event, ctx) => {
    const url = socketAddress();
    if (!url) {
      // Честное молчание вместо мнимого слуха: делатель должен знать, что он нем.
      if (ctx.hasUI) {
        ctx.ui.notify(
          "Искрон: канал не открыт — нет ISKRON_CHANNEL_SOCKET. Займи стояние (скилл standing) и перезапусти сессию.",
          "warn",
        );
      }
      return;
    }
    stopped = false;
    open(url, ctx);
    startSaying(url, ctx);
  });

  pi.on("session_shutdown", async () => {
    // Идемпотентно: pi зовёт это и на путях, где ничего не поднималось.
    stopped = true;
    if (timer) clearTimeout(timer);
    if (sayTimer) clearInterval(sayTimer);
    timer = sayTimer = null;
    try {
      socket?.close(1000, "session shutdown");
    } catch {
      /* закрывать нечего */
    }
    socket = null;
  });

  function open(url: string, ctx: any) {
    if (stopped) return;
    const startedAt = Date.now(); // от конструкции, НЕ в onopen — см. channel.md
    const ws = new WebSocket(url);
    socket = ws;
    let gone = false; // обрыв разбирается один раз, чем бы он ни пришёл

    ws.addEventListener("message", (e: MessageEvent) => {
      const body = typeof e.data === "string" ? e.data : "[двоичный кадр]";
      let frame: any = null;
      try {
        frame = JSON.parse(body);
      } catch {
        /* неJSON — донесём как есть */
      }
      // Служебные кадры не будят: hello доказывает, что сокет держат, и только.
      if (frame?.type === "hello") {
        if (ctx.hasUI) ctx.ui.setStatus?.("Искрон: канал слушает");
        return;
      }
      if (frame?.type === "status") return;

      // Вот ради чего всё: кадр входит в идущий ход, а простаивающего агента
      // поднимает. Это и есть то, чего у сторожа-процесса быть не может.
      pi.sendMessage(
        {
          customType: "iskron-channel",
          content: frameToText(frame, body),
          display: true,
          details: frame ?? { raw: body },
        },
        { triggerTurn: true, deliverAs: "steer" },
      );
    });

    // Обрыв на самом апгрейде даёт на части рантаймов ТОЛЬКО error: close не
    // приходит вовсе. Отсрочка оставляет close шанс назвать свой код — коды
    // мёртвого токена приходят именно им.
    ws.addEventListener("error", () => setTimeout(() => dropped(1006, url, ctx), 500));
    ws.addEventListener("close", (e: CloseEvent) => dropped(e.code, url, ctx));

    async function dropped(code: number, u: string, c: any) {
      if (gone || stopped) return;
      gone = true;

      if (DEAD_TOKEN.includes(code)) {
        // Процессу здесь выйти некуда, поэтому громкость — это сказать делателю
        // так, чтобы он это увидел в ходе, а не в логе, которого никто не читает.
        loud(
          c,
          `Искрон: канал закрыт кодом ${code} — токен мёртв. Зови iskron_channel(action="connect")` +
            (code === 4001 ? ' или action="mint"' : "") +
            ", затем register тем же именем и перезапусти сессию.",
        );
        return;
      }

      fastDrops = Date.now() - startedAt < 5000 ? fastDrops + 1 : 0;
      if (fastDrops >= 3) {
        const up = await serviceUp(u);
        if (up) {
          loud(c, `Искрон: обрывы, а служба отвечает (${up.version}) — спроси о токене.`);
          return;
        }
        fastDrops = 1; // простой не должен перерасти в вопрос о токене
      }
      timer = setTimeout(() => open(u, c), code === ROLLOUT ? 3000 : 2000);
    }
  }

  function loud(ctx: any, text: string) {
    stopped = true;
    if (ctx?.hasUI) ctx.ui.notify(text, "error");
    pi.sendMessage(
      { customType: "iskron-channel", content: text, display: true, details: { fatal: true } },
      { triggerTurn: true, deliverAs: "steer" },
    );
  }

  // ── Слово делателя наружу: строка занятости ───────────────────────────────
  // Строку удостоверяет слушающий секрет, а он здесь. Делатель пишет ТЕКСТ в
  // файл, публикует расширение. Опрос, а не наблюдение: файла может ещё не быть,
  // а наблюдатель за несуществующим путём бросает.
  function startSaying(url: string, _ctx: any) {
    const sayFile = process.env.ISKRON_CHANNEL_SAY;
    if (!sayFile) return; // без переменной половина не включается
    const statusUrl =
      process.env.ISKRON_CHANNEL_STATUS ||
      url.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace("/channel/ws/", "/channel/status/");
    let said: string | null = null;
    sayTimer = setInterval(async () => {
      let text: string;
      try {
        text = readFileSync(sayFile, "utf8").trim();
      } catch {
        return; // ещё не написали — не о чем говорить
      }
      if (text === said) return; // публикуют смену занятия, а не такт
      const res = await fetch(statusUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);
      // Пустая строка — СЛОВО: ею занятость снимают.
      if (res?.ok) said = text;
      else if (res && res.status >= 400 && res.status < 500) said = text; // повтор той же ничего не изменит
    }, 1000);
    sayTimer.unref?.();
  }
}

function frameToText(frame: any, raw: string): string {
  if (!frame) return `Кадр канала Искрона:\n${raw}`;
  const from = frame.provenance?.from_standing || frame.provenance?.from_karta_seq;
  const head = from ? `Кадр канала Искрона от ${from}` : "Кадр канала Искрона";
  const body = typeof frame.body === "string" ? frame.body : raw;
  // Провенанс несут отдельной строкой: кто говорит, читается из происхождения
  // кадра, никогда из тела — телу любой держатель адреса придаст любой вид.
  return `${head}:\n\n${body}`;
}

async function serviceUp(url: string): Promise<{ version?: string } | null> {
  const version =
    new URL(url).origin.replace(/^wss:/, "https:").replace(/^ws:/, "http:") + "/api/version";
  return fetch(version, { signal: AbortSignal.timeout(5000) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}
