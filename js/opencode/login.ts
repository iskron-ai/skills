// Вход человека в браузере — общий на все мосты плагина (tools.ts): сказать
// один раз на вход, а вызов, ждущий рукопожатия, отпустить в миг, когда мост
// запросил вход, — человека внутри вызова не ждут, адрес уходит ответом.
import type { Say } from "./tools.ts";

export interface Login {
  /** Мост ждёт входа человека. */
  readonly pending: boolean;
  /** Адрес входа, который назвал мост. */
  readonly url: string | null;
  /** Страница входа с кодом — тот же вход с другого устройства, если мост её назвал. */
  readonly device: string | null;
  /** Мост запросил вход (handshake): ждущие отпускаются, человеку — слово, одно на вход. */
  on(url: string | null, device?: string | null): void;
  /** Рукопожатие прошло — вход кончился. */
  done(): void;
  /** Рукопожатие под гонкой со входом: запрошенный вход — отказ вызова с адресом. */
  race(ready: () => Promise<void>): Promise<void>;
}

/**
 * Как войти не с машины OpenCode: страница с кодом, если сервер её даёт, иначе
 * туннель или токен. `device` без адреса — слово моста, почему кода нет.
 */
export function elsewhere(device: string | null): string {
  return device && /^https?:/.test(device)
    ? `с другого устройства (телефон подойдёт) — ${device}; либо личный токен в ~/.iskron-bridge/token`
    : (device ? `${device}; ` : "") +
        "с другой машины — ssh -L <порт>:127.0.0.1:<порт>, либо личный токен в ~/.iskron-bridge/token";
}

export function createLogin(say: Say): Login {
  // Вход кончился или мост открыл новый (другая ссылка) — скажется снова.
  let pending = false;
  let url: string | null = null;
  let device: string | null = null;
  const waiters = new Set<() => void>();
  /** Обещание входа и его снятие — вызов, кончившийся иначе, ждуна за собой не оставляет. */
  function started(): { promise: Promise<void>; cancel: () => void } {
    if (pending) return { promise: Promise.resolve(), cancel() {} };
    let waiter: () => void = () => {};
    const promise = new Promise<void>((r) => (waiter = r));
    waiters.add(waiter);
    return { promise, cancel: () => waiters.delete(waiter) };
  }
  function error(): Error {
    return new Error(
      `Искрон: нужен вход в граф — ${url ? `открой в браузере ${url}` : "заверши вход в браузере"} и повтори вызов. ` +
        `Адрес локальный для машины OpenCode: ${elsewhere(device)} (скилл establish-mcp).`,
    );
  }
  return {
    get pending() {
      return pending;
    },
    get url() {
      return url;
    },
    get device() {
      return device;
    },
    on(next, nextDevice = null) {
      for (const w of waiters) w();
      waiters.clear();
      if (pending && next === url && nextDevice === device) return;
      pending = true;
      url = next;
      device = nextDevice;
      say(
        `Искрон: нужен вход — ${next ? `открой ${next} и заверши его` : "заверши его в браузере"}; ` +
          `адрес локальный: ${elsewhere(device)}. ` +
          "Тулы iskron_* поднимутся после входа сами.",
        "warning",
      );
    },
    done() {
      pending = false;
      url = null;
      device = null;
    },
    async race(ready) {
      if (pending) throw error();
      const login = started();
      try {
        await Promise.race([
          ready(),
          login.promise.then(() => {
            throw error();
          }),
        ]);
      } finally {
        login.cancel();
      }
    },
  };
}
