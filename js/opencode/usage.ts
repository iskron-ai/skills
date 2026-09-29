// Расход сессии OpenCode для attrs места (граф nks-dev: #6271). Из событий
// сервиса: session.usage.updated — потрачено сессией накопительно,
// session.step.started — модель шага, session.step.ended — сколько вошло в окно
// на этом шаге; размер окна — limit.context модели из ctx.model.list().
// Мосту уходит не чаще раза в DEBOUNCE_MS на сессию: мост сам решает, стоит ли
// сдвиг вызова на сервер (bridge/usage.ts).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { type Bridge } from "../shared/bridge-client.ts";

export interface UsagePayload {
  tokens?: number;
  context?: number;
  window?: number;
}

const DEBOUNCE_MS = Number(process.env.ISKRON_USAGE_DEBOUNCE_MS || 10_000);

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Токены одного отчёта сервиса: новые (без чтения кеша) — «потрачено», всё входное — «в окне». */
const spent = (t: any): number => n(t?.input) + n(t?.output) + n(t?.reasoning) + n(t?.cache?.write);
const inWindow = (t: any): number => n(t?.input) + n(t?.cache?.read) + n(t?.cache?.write);

export function createUsageFeed(opts: {
  listModels: () => Promise<unknown>;
  /** Мост держащего слота сессии; null — места нет, отдавать некуда. */
  bridgeOf: (session: string) => Bridge | null;
}): { onEvent: (ev: any) => void; stop: () => void } {
  const bySession = new Map<string, UsagePayload & { model?: string }>();
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

  const flush = (session: string): void => {
    timers.delete(session);
    const u = bySession.get(session);
    if (!u) return;
    const { model, ...p } = u;
    if (model && windows.has(model)) p.window = windows.get(model);
    void opts
      .bridgeOf(session)
      ?.request("iskron/usage", p, { timeoutMs: 10_000 })
      .catch(() => {});
  };
  const schedule = (session: string): void => {
    if (!timers.has(session)) {
      const t = setTimeout(() => flush(session), DEBOUNCE_MS);
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
          if (m?.id) u.model = `${m.providerID ?? ""}/${m.id}`;
          void loadWindows();
          break;
        }
        case "session.step.ended":
          if (!ev.data?.tokens) return;
          u.context = inWindow(ev.data.tokens);
          break;
        case "session.usage.updated":
          if (!ev.data?.tokens) return;
          u.tokens = spent(ev.data.tokens);
          break;
        default:
          return;
      }
      bySession.set(session, u);
      schedule(session);
    },
    stop(): void {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
