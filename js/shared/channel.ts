// Протокол живого канала со стороны держателя сокета — один раз для всех, кто
// его держит: двух сторожей и расширения pi. Прежде это было написано трижды и
// расходилось молча; дисциплина здесь выведена полем, а не выдумана — боевые
// заметки в skills/standing/references/channel.md.
//
// Три правила, каждое — строчка кода ниже:
//   попытка считается ОТ КОНСТРУКЦИИ, никогда от onopen: токен, который служба
//     забыла, отвергается на апгрейде, и onopen не наступает вовсе;
//   коды мёртвого токена проходят любую ограду и снимают назначенное
//     переоткрытие: настоящий код приходит close-ом и может опоздать за
//     догадкой 1006, которую даёт error;
//   три быстрых обрыва спрашивают /version прежде, чем винить токен: служба
//     жива, а нас рвёт — вопрос делателю; служба молчит — выкатка, держим токен.

/** Закрытия, после которых тем же токеном не переоткрываются. */
export const DEAD_TOKEN_CODES = [4000, 4001, 4002];
/** Выкатка: инстанс уходит, вдох длиннее обычного. */
export const ROLLOUT_CODE = 4003;

const FAST_DROP_MS = 5000;
const ERROR_GUESS_DELAY_MS = 500;

/** Обе схемы: с одним `wss:` вопрос службе на ws-адресе не уходил вовсе. */
function httpOrigin(socketUrl: string): string {
  return new URL(socketUrl).origin.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

export function versionUrl(socketUrl: string): string {
  return httpOrigin(socketUrl) + "/api/version";
}

/**
 * Статусный адрес выводится, а не хранится вторым секретом. Вывод — фолбэк:
 * выданная рядом с сокетом строка всегда права, задавай её первой.
 */
export function statusUrl(socketUrl: string): string {
  return socketUrl
    .replace(/^wss:/, "https:")
    .replace(/^ws:/, "http:")
    .replace("/channel/ws/", "/channel/status/");
}

export async function serviceUp(socketUrl: string): Promise<{ version?: string } | null> {
  return fetch(versionUrl(socketUrl), { signal: AbortSignal.timeout(5000) })
    .then((r) => (r.ok ? (r.json() as Promise<{ version?: string }>) : null))
    .catch(() => null);
}

/** Слово делателю на мёртвом токене — одно на всех держателей. */
export function deadTokenAdvice(code: number): string {
  return `закрытие ${code} — токен мёртв, зови connect${code === 4001 ? " (на 4001 — mint)" : ""}`;
}

export interface Frame {
  type?: string;
  body?: unknown;
  provenance?: { from_standing?: string; from_karta_seq?: number };
  [k: string]: unknown;
}

export interface HoldOptions {
  url: string;
  /** Каждый кадр: сырой текст и разобранный JSON, если разобрался. */
  onFrame: (raw: string, frame: Frame | null) => void;
  /** Мёртвый токен: держание кончилось, тем же токеном не вернуться. Зовётся один раз. */
  onDeadToken: (code: number) => void;
  /** Обрывы при живой службе: держание кончилось, вопрос о токене — делателю. Один раз. */
  onServiceAlive: (version: string) => void;
  /** Служебные слова, которые будить не должны. */
  onNote?: (text: string) => void;
}

export interface Holder {
  /** Отпустить сокет: больше ни переоткрытий, ни кадров. Идемпотентно. */
  close(reason?: string): void;
  /** Живой ли сокет (открыт или открывается). */
  readonly alive: boolean;
}

/**
 * Держать сокет открытым, переоткрывая по обрыву, и доставлять кадры. Что
 * делать с кадром и как громко уходить — решает вызывающий: у сторожа под
 * Monitor это печать и выход процесса, у сторожа выхода-на-кадре — выход нулём
 * на первом сообщении, у расширения — кадр в идущий ход.
 */
export function holdSocket(o: HoldOptions): Holder {
  let fastDrops = 0;
  let dead = false;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let ws: WebSocket | null = null;

  function open(): void {
    if (stopped) return;
    const startedAt = Date.now(); // от конструкции, НЕ в onopen — см. channel.md
    const sock = new WebSocket(o.url);
    ws = sock;
    let gone = false; // обрыв разбирается один раз, чем бы он ни пришёл

    sock.addEventListener("message", (e: MessageEvent) => {
      if (stopped || ws !== sock) return;
      const raw = typeof e.data === "string" ? e.data : "[двоичный кадр]";
      let frame: Frame | null = null;
      if (typeof e.data === "string") {
        try {
          frame = JSON.parse(raw) as Frame;
        } catch {
          /* не JSON — донесём как есть */
        }
      }
      o.onFrame(raw, frame && typeof frame === "object" ? frame : null);
    });
    // Обрыв на самом апгрейде даёт на части рантаймов ТОЛЬКО error: close не
    // приходит вовсе, и держатель, ждущий одного close, тихо умирает вместе с
    // пустым циклом событий (замерено на Node 22). Отсрочка оставляет close
    // шанс назвать свой код — коды мёртвого токена приходят именно им.
    sock.addEventListener("error", () =>
      setTimeout(() => void dropped(1006), ERROR_GUESS_DELAY_MS),
    );
    sock.addEventListener("close", (e) => void dropped((e as unknown as { code: number }).code));

    async function dropped(code: number): Promise<void> {
      if (stopped || ws !== sock) return;
      // Мёртвый токен громче любого предположения об обрыве: он проходит ограду
      // `gone` всегда и снимает уже назначенное переоткрытие.
      if (DEAD_TOKEN_CODES.includes(code)) {
        if (dead) return;
        dead = true;
        stopped = true;
        if (retry) clearTimeout(retry);
        o.onDeadToken(code);
        return;
      }
      if (gone) return;
      gone = true;
      fastDrops = Date.now() - startedAt < FAST_DROP_MS ? fastDrops + 1 : 0;
      if (fastDrops >= 3) {
        const up = await serviceUp(o.url);
        if (stopped || ws !== sock) return;
        if (up) {
          // Служба жива, а нас рвёт: переоткрывать нечего, и уйти молча нельзя —
          // делатель остался бы с виду слышимым.
          stopped = true;
          o.onServiceAlive(String(up.version ?? ""));
          return;
        }
        o.onNote?.("служба не отвечает — идёт раскатка, держу тот же токен");
        fastDrops = 1; // простой не должен перерасти в вопрос о токене
      }
      retry = setTimeout(open, code === ROLLOUT_CODE ? 3000 : 2000);
    }
  }

  open();
  return {
    close(reason = "held no more") {
      stopped = true;
      if (retry) clearTimeout(retry);
      retry = null;
      const sock = ws;
      ws = null;
      try {
        sock?.close(1000, reason);
      } catch {
        /* закрывать нечего */
      }
    },
    get alive() {
      return !stopped && !!ws && (ws.readyState === 0 || ws.readyState === 1);
    },
  };
}

export interface SayOptions {
  /** Файл, в который делатель пишет ТЕКСТ строки занятости. */
  sayFile: string;
  statusUrl: string;
  /** Строку не приняли: раз на текст, не раз в секунду. */
  onRefused?: (text: string, status: number | null) => void;
  intervalMs?: number;
}

/**
 * Слово делателя наружу: строку занятости удостоверяет слушающий секрет, а он у
 * держателя сокета, не у рабочей сессии. Делатель пишет текст в файл, публикует
 * держатель. Опрос, а не наблюдение: файла может ещё не быть, а наблюдатель за
 * несуществующим путём бросает; пересоздание целиком опрос тоже переживает.
 */
export function startSaying(o: SayOptions, readText: (file: string) => string): { stop(): void } {
  let said: string | null = null;
  let complained: string | null = null;
  async function say(): Promise<void> {
    let text: string;
    try {
      text = readText(o.sayFile).trim();
    } catch {
      return; // ещё не написали — не о чем говорить
    }
    if (text === said) return; // публикуют смену занятия, а не такт
    const res = await fetch(o.statusUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    if (res?.ok) {
      said = text; // пустая строка — СЛОВО: ею занятость снимают
      complained = null;
      return;
    }
    if (complained !== text) {
      complained = text;
      o.onRefused?.(text, res ? res.status : null);
    }
    if (res && res.status >= 400 && res.status < 500) said = text; // отказ по самой строке: повтор той же ничего не изменит
  }
  const timer = setInterval(() => void say(), o.intervalMs ?? 1000);
  timer.unref?.(); // таймер не смеет держать процесс, чей сокет умер
  return {
    stop() {
      clearInterval(timer);
    },
  };
}
