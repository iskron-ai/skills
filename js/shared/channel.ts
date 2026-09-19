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
//     жива, а нас рвёт — слово делателю и переоткрытие реже, место не бросаем;
//     служба молчит — выкатка, держим токен.
//   соединение, молчащее дольше трёх интервалов пинга из hello, переоткрывается
//     тем же адресом вслух (граф nks-dev: #5397); пока ни одного пинга не видно,
//     таймер не взведён — рантайм, не показывающий пингов, живое мёртвым не объявит.

// Пространством имён, не именованным импортом: модуль линкуется и там, где этих
// экспортов нет. Bun канал не наполняет — его пинги приходят событием сокета (ниже).
import * as diagnostics from "node:diagnostics_channel";

/** Канал, в который undici (WebSocket Node) публикует каждый входящий протокольный пинг. */
const PING_CHANNEL = "undici:websocket:ping";
/** Сколько интервалов пинга соединение может молчать, прежде чем считаться подвисшим. */
const SILENT_INTERVALS = 3;
/**
 * Свой пол молчания: пинг контура — каденс ЕГО живости (три неотвеченных — его
 * терпение), и при пинге раз в 5 с три интервала короче паузы цикла событий у
 * харнеса; здоровое соединение не должно читаться подвисшим (граф nks-dev: #5380).
 */
const SILENT_FLOOR_MS = Number(process.env.ISKRON_CHANNEL_SILENT_FLOOR_MS) || 60_000;

/** Закрытия, после которых тем же токеном не переоткрываются. */
export const DEAD_TOKEN_CODES = [4001, 4002];
/**
 * Вытеснение: каналом владеет другой держатель — новое подключение либо
 * переизданный секрет. Не смерть токена: тем же адресом открываются заново
 * один раз (вытеснили — вернулись; 404 — адрес повернули connect-ом другого).
 * Второе вытеснение в окне — либо тот же код, либо быстрый обрыв переоткрытия
 * (повёрнутый адрес не открывается) — место держит другой, и держатель
 * уступает вслух, не отбирая сокет по кругу (граф nks-dev: #5033).
 */
export const EVICTED_CODE = 4000;
const EVICTION_WINDOW_MS = 60_000;
/** Выкатка: инстанс уходит, вдох длиннее обычного. */
export const ROLLOUT_CODE = 4003;

const FAST_DROP_MS = 5000;
const ERROR_GUESS_DELAY_MS = 500;
/**
 * Паузы переоткрытия, когда служба жива, а сокет рвут: растут до потолка и
 * сбрасываются сокетом, прожившим дольше быстрого обрыва (граф nks-dev: #4664).
 */
const FLAP_PAUSES_MS = (process.env.ISKRON_CHANNEL_FLAP_MS || "5000,10000,20000,40000,60000")
  .split(",")
  .map(Number)
  .filter((n) => Number.isFinite(n) && n > 0);

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
  return `закрытие ${code} — токен мёртв, зови ${code === 4001 ? "mint" : "connect"}`;
}

export type FrameOrigin = "platform" | "human" | "sibling" | "peer";

/**
 * Кто говорит — по провенансу, как платформа его наблюдала. Побудка платформы
 * идёт без удостоверения; человек говорит от собственной роли (стояние его роли
 * — бот, телеграм) либо от себя; брат — другое стояние ТОЙ ЖЕ роли, что у
 * читающего; остальное — делатель другой роли. myKarta — роль читающего.
 * Платформенность решает пара путь плюс удостоверение, а устойчивый признак —
 * ОТСУТСТВИЕ АВТОРА: запись, которую пишет сама платформа (побудка, left при
 * отзыве стояния в комнате), не несёт ни роли, ни стояния; литерал
 * удостоверения (none, platform) — второй признак того же, не первый.
 */
export function classifyOrigin(frame: Frame, myKarta?: string | number | null): FrameOrigin {
  const p = frame.provenance ?? {};
  // Запись комнаты без автора пишет сама платформа (left при отзыве стояния):
  // только там отсутствие автора — её слово. Вне комнаты молчание from_standing —
  // честное молчание, не заявка (граф nks-dev: #2287).
  const noAuthor = p.via === "room" && p.from_karta_seq == null && !p.from_standing;
  if (p.via === "platform" || p.auth === "none" || p.auth === "platform" || noAuthor)
    return "platform";
  if (p.as_person === true) return "human";
  if (p.from_karta_seq != null && p.user_karta_seq != null && p.from_karta_seq === p.user_karta_seq)
    return "human";
  if (myKarta != null && p.from_karta_seq != null && String(p.from_karta_seq) === String(myKarta))
    return "sibling";
  return "peer";
}

export interface Frame {
  type?: string;
  body?: unknown;
  id?: string;
  received_at?: string;
  stale?: boolean;
  content_type?: string;
  body_chars?: number;
  /** Как получено тело: "history" — мост дочитал обрезанный кадр; "truncated: …" — не вышло. */
  body_read?: string;
  /** Кто говорит, по провенансу: платформа, человек, брат по роли, делатель другой роли. Ставит мост. */
  origin?: FrameOrigin;
  provenance?: {
    from_standing?: string;
    from_karta_seq?: number;
    auth?: string;
    via?: string;
    user?: string;
    user_karta_seq?: number;
    in_reply_to?: string;
    as_person?: boolean;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface HoldOptions {
  url: string;
  /** Каждый кадр: сырой текст и разобранный JSON, если разобрался. */
  onFrame: (raw: string, frame: Frame | null) => void;
  /** Мёртвый токен: держание кончилось, тем же токеном не вернуться. Зовётся один раз. */
  onDeadToken: (code: number) => void;
  /** Вытеснение повторилось: место слушает другой держатель, держание кончилось, привязка цела. Зовётся один раз; без него — как мёртвый токен. */
  onEvicted?: (code: number) => void;
  /** Обрывы при живой службе: держание идёт реже, вопрос о токене — делателю. Раз на полосу обрывов. */
  onServiceAlive: (version: string) => void;
  /** Служебные слова, которые будить не должны. */
  onNote?: (text: string) => void;
  /** Соединение подвисло и переоткрывается: кадры могли пропасть — слово громче служебного. Без него — как onNote. */
  onHung?: (text: string) => void;
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
  let slowdown = 0; // сколько пауз подряд служба жива, а сокет рвут
  let dead = false;
  let stopped = false;
  let lastEviction: number | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let ws: WebSocket | null = null;
  // Живость соединения: последний знак от службы (пинг или кадр), интервал из
  // hello; таймер взводит первый увиденный пинг.
  let lastLife = 0;
  let pingMs = 0;
  // Видит ли рантайм пинги вообще — держится на весь holder: соединение,
  // подвисшее до своего первого пинга, иначе не поймалось бы никогда.
  let runtimeSeesPings = false;
  let lastTick = 0;
  let watch: ReturnType<typeof setInterval> | null = null;
  // Node 22 не называет сокет пинга, Node 26 называет: чужой пинг может лишь
  // продлить жизнь, но не объявить живое мёртвым — у моста сокет один.
  const onPing = (m: unknown): void => {
    const from = (m as { websocket?: unknown } | null)?.websocket;
    if (!ws || (from !== undefined && from !== ws)) return;
    lastLife = Date.now();
    runtimeSeesPings = true;
  };
  diagnostics.subscribe?.(PING_CHANNEL, onPing);
  const unsubscribePing = (): void => {
    diagnostics.unsubscribe?.(PING_CHANNEL, onPing);
  };
  const stopWatch = (): void => {
    if (watch) clearInterval(watch);
    watch = null;
  };

  function open(): void {
    if (stopped) return;
    const startedAt = Date.now(); // от конструкции, НЕ в onopen — см. channel.md
    const sock = new WebSocket(o.url);
    ws = sock;
    stopWatch();
    lastLife = startedAt;
    let gone = false; // обрыв разбирается один раз, чем бы он ни пришёл
    let opened = false; // апгрейд прошёл: повёрнутый адрес не открывается вовсе
    sock.addEventListener("open", () => {
      opened = true;
    });
    // Bun (рантайм моста в OpenCode) канала диагностики не наполняет, но шлёт
    // нестандартное событие ping самого сокета; Node его не шлёт вовсе.
    sock.addEventListener("ping", () => {
      if (ws !== sock) return;
      lastLife = Date.now();
      runtimeSeesPings = true;
    });

    sock.addEventListener("message", (e: MessageEvent) => {
      if (stopped || ws !== sock) return;
      lastLife = Date.now();
      const raw = typeof e.data === "string" ? e.data : "[двоичный кадр]";
      let frame: Frame | null = null;
      if (typeof e.data === "string") {
        try {
          frame = JSON.parse(raw) as Frame;
        } catch {
          /* не JSON — донесём как есть */
        }
      }
      if (frame?.type === "hello") watchLife(Number(frame.ping_interval_seconds) * 1000);
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

    function watchLife(interval: number): void {
      stopWatch();
      if (!(interval > 0)) return;
      pingMs = interval;
      const every = Math.max(pingMs, 250);
      lastTick = Date.now();
      watch = setInterval(() => {
        const now = Date.now();
        // Таймер опоздал на интервалы — спал процесс (крышка ноутбука), а не
        // служба: молчание меряется заново, иначе живое назвали бы подвисшим.
        if (now - lastTick > 2 * every + 1000) lastLife = now;
        lastTick = now;
        if (stopped || ws !== sock || !runtimeSeesPings) return;
        const silent = now - lastLife;
        if (silent <= Math.max(SILENT_INTERVALS * pingMs + 1000, SILENT_FLOOR_MS)) return;
        stopWatch();
        // «Прочитано» у контура значит «записано в сокет», не «взято» (#5380):
        // кадры, ушедшие в подвисшее соединение, в hello не вернутся.
        (o.onHung ?? o.onNote)?.(
          `соединение молчит ${Math.round(silent / 1000)} с при пинге раз в ${pingMs / 1000} с — подвисло без закрытия; переоткрываю тем же адресом. Кадры, пришедшие за время молчания, могли пропасть — сверь iskron_channel(action="history")`,
        );
        try {
          sock.close();
        } catch {
          /* закрывать нечего */
        }
        void dropped(1006);
      }, every);
      watch.unref?.();
    }

    function yieldTo(cb: (code: number) => void, code: number): void {
      if (dead) return;
      dead = true;
      stopped = true;
      if (retry) clearTimeout(retry);
      stopWatch();
      unsubscribePing();
      cb(code);
    }

    async function dropped(code: number): Promise<void> {
      if (stopped || ws !== sock) return;
      stopWatch();
      // Мёртвый токен громче любого предположения об обрыве и старше вытеснения:
      // он проходит ограду `gone` всегда и снимает уже назначенное переоткрытие.
      if (DEAD_TOKEN_CODES.includes(code)) return yieldTo(o.onDeadToken, code);
      const now = Date.now();
      const afterEviction = lastEviction !== null && now - lastEviction < EVICTION_WINDOW_MS;
      // Повторное вытеснение проходит ограду `gone` так же, как мёртвый токен.
      if (afterEviction && code === EVICTED_CODE)
        return yieldTo(o.onEvicted ?? o.onDeadToken, code);
      if (code === EVICTED_CODE) {
        lastEviction = now;
        if (gone) return; // переоткрытие уже назначено догадкой
        gone = true;
        o.onNote?.("закрытие 4000 — место у другого держателя; открываю заново один раз");
        retry = setTimeout(open, 2000);
        return;
      }
      if (gone) return;
      // Переоткрытие после вытеснения не открылось вовсе: адрес повернул чужой
      // connect (404 на апгрейде) — или это сеть. Различает служба: жива —
      // адрес повернули, уступаем; молчит — выкатка или сеть, держим как обычно.
      if (afterEviction && !opened && code !== ROLLOUT_CODE && now - startedAt < FAST_DROP_MS) {
        gone = true;
        const up = await serviceUp(o.url);
        if (stopped || ws !== sock) return;
        if (up) return yieldTo(o.onEvicted ?? o.onDeadToken, EVICTED_CODE);
        retry = setTimeout(open, 2000);
        return;
      }
      gone = true;
      const fast = Date.now() - startedAt < FAST_DROP_MS;
      fastDrops = fast ? fastDrops + 1 : 0;
      if (!fast) slowdown = 0; // сокет прожил — полоса обрывов кончилась
      if (fastDrops >= 3) {
        const up = await serviceUp(o.url);
        if (stopped || ws !== sock) return;
        if (up) {
          // Служба жива, а нас рвёт. Бросить место нельзя — грант жив, и сеть
          // может вернуться; молчать тоже — делатель остался бы с виду слышимым.
          // Слово — один раз на полосу обрывов, переоткрытие — всё реже.
          if (slowdown === 0) o.onServiceAlive(String(up.version ?? ""));
          const wait = FLAP_PAUSES_MS[Math.min(slowdown, FLAP_PAUSES_MS.length - 1)] ?? 60_000;
          slowdown++;
          fastDrops = 2; // следующий быстрый обрыв снова спросит службу, но не делателя
          retry = setTimeout(open, wait);
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
      stopWatch();
      unsubscribePing();
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
