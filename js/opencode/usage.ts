// Расход сессии OpenCode для attrs места (граф nks-dev: #6271, #6401). Из событий
// сервиса: session.usage.updated — потрачено сессией накопительно, по видам
// токенов; session.step.started — модель шага; session.step.ended — сколько
// вошло в окно на этом шаге; размер окна — limit.context модели из ctx.model.list().
// Мосту уходит не чаще раза в DEBOUNCE_MS на сессию: мост сам решает, стоит ли
// сдвиг вызова на сервер (bridge/usage.ts). Конец прогона и удаление сессии
// сбрасывают ждущий снимок сразу (flush) — до того, как мост уйдёт с местом.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { envName } from "../delivery/index.ts";
import { type Bridge } from "../shared/bridge-client.ts";

export interface UsagePayload {
  tokens?: number;
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  model?: string;
  context?: number;
  window?: number;
}

const DEBOUNCE_MS = Number(process.env[envName("USAGE_DEBOUNCE_MS")] || 10_000);

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Токены одного отчёта сервиса: новые (без чтения кеша) — «потрачено», всё входное — «в окне». */
const spent = (t: any): number => n(t?.input) + n(t?.output) + n(t?.reasoning) + n(t?.cache?.write);
const inWindow = (t: any): number => n(t?.input) + n(t?.cache?.read) + n(t?.cache?.write);
/** По видам: рассуждение — выход модели. */
const kinds = (t: any): UsagePayload => ({
  input: n(t?.input),
  output: n(t?.output) + n(t?.reasoning),
  cache_read: n(t?.cache?.read),
  cache_write: n(t?.cache?.write),
});

export interface UsageFeed {
  onEvent: (ev: any) => void;
  /** Ждущий снимок сессии — мосту сейчас, мимо паузы; ждать ответа моста. */
  flush: (session: string) => Promise<void>;
  forget: (session: string) => void;
  stop: () => void;
}

export function createUsageFeed(opts: {
  listModels: () => Promise<unknown>;
  /** Мост, держащий место самой сессии; null — места нет, отдавать некуда. */
  bridgeOf: (session: string) => Bridge | null;
}): UsageFeed {
  const bySession = new Map<string, UsagePayload & { ref?: string }>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const windows = new Map<string, number>(); // "provider/model" → limit.context
  let listed: Promise<void> | null = null;

  const loadWindows = (): Promise<void> =>
    (listed ??= (async () => {
      try {
        const out: any = await opts.listModels();
        const list: any[] = Array.isArray(out) ? out : (out?.data ?? out?.models ?? []);
        for (const m of list) {
          const ctx = n(m?.limit?.context);
          const id = m?.id ?? m?.modelID;
          const prov = m?.providerID ?? m?.provider?.id;
          if (ctx && id) windows.set(`${prov ?? ""}/${id}`, ctx);
        }
      } catch {
        listed = null; // список не пришёл — спросим снова на следующем шаге
      }
    })());

  // Снимки сессии уходят мосту по одному: следующий — после ответа на ушедший,
  // иначе последний обогнал бы предыдущий, и место легло бы со старыми цифрами.
  const inFlight = new Map<string, Promise<void>>();
  const send = async (session: string, timeoutMs: number): Promise<void> => {
    const u = bySession.get(session);
    if (!u) return;
    const { ref, ...p } = u;
    if (ref && windows.has(ref)) p.window = windows.get(ref);
    await opts
      .bridgeOf(session)
      ?.request("iskron/usage", p, { timeoutMs })
      .catch(() => {});
  };
  const flush = (session: string, timeoutMs = 10_000): Promise<void> => {
    clearTimeout(timers.get(session));
    timers.delete(session);
    // Цифры берутся в миг отправки, не постановки: уходит последний снимок.
    const p = (inFlight.get(session) ?? Promise.resolve()).then(() => send(session, timeoutMs));
    inFlight.set(session, p);
    void p.finally(() => {
      if (inFlight.get(session) === p) inFlight.delete(session);
    });
    return p;
  };
  const schedule = (session: string): void => {
    if (!timers.has(session)) {
      const t = setTimeout(() => void flush(session), DEBOUNCE_MS);
      t.unref?.();
      timers.set(session, t);
    }
  };

  return {
    onEvent(ev: any): void {
      const session: unknown = ev?.data?.sessionID;
      if (typeof session !== "string") return;
      const u = bySession.get(session) ?? {};
      switch (ev?.type) {
        case "session.step.started": {
          const m = ev.data?.model;
          if (m?.id) {
            u.ref = `${m.providerID ?? ""}/${m.id}`;
            u.model = String(m.id);
          }
          void loadWindows();
          break;
        }
        case "session.step.ended":
          if (!ev.data?.tokens) return;
          u.context = inWindow(ev.data.tokens);
          break;
        case "session.usage.updated":
          if (!ev.data?.tokens) return;
          Object.assign(u, { tokens: spent(ev.data.tokens), ...kinds(ev.data.tokens) });
          break;
        default:
          return;
      }
      bySession.set(session, u);
      schedule(session);
    },
    // Ждущего снимка нет — дождаться ушедшего: мост не уходит с местом раньше его ответа.
    flush: (session) =>
      timers.has(session) ? flush(session, 3_000) : (inFlight.get(session) ?? Promise.resolve()),
    forget(session: string): void {
      clearTimeout(timers.get(session));
      timers.delete(session);
      bySession.delete(session);
    },
    stop(): void {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      bySession.clear();
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
