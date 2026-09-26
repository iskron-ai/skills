// Вход человека в браузере — общий на все мосты плагина (tools.ts): сказать
// один раз на вход, а вызов, ждущий рукопожатия, отпустить в миг, когда мост
// запросил вход, — человека внутри вызова не ждут, адрес уходит ответом.
import type { Say } from "./tools.ts";

export interface Login {
  /** Мост ждёт входа человека. */
  readonly pending: boolean;
  /** Адрес входа, который назвал мост. */
  readonly url: string | null;
  /** Мост запросил вход (handshake): ждущие отпускаются, человеку — слово, одно на вход. */
  on(url: string | null): void;
  /** Рукопожатие прошло — вход кончился. */
  done(): void;
  /** Рукопожатие под гонкой со входом: запрошенный вход — отказ вызова с адресом. */
  race(ready: () => Promise<void>): Promise<void>;
}

export function createLogin(say: Say): Login {
  // Вход кончился или мост открыл новый (другая ссылка) — скажется снова.
  let pending = false;
  let url: string | null = null;
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
        "Адрес локальный для машины OpenCode: с другой — ssh -L <порт>:127.0.0.1:<порт>; " +
        "на безголовой машине положи личный токен в ~/.iskron-bridge/token (скилл establish-mcp).",
    );
  }
  return {
    get pending() {
      return pending;
    },
    get url() {
      return url;
    },
    on(next) {
      for (const w of waiters) w();
      waiters.clear();
      if (pending && next === url) return;
      pending = true;
      url = next;
      say(
        `Искрон: нужен вход — ${next ? `открой ${next} и заверши его` : "заверши его в браузере"}; ` +
          "адрес локальный: с другой машины — ssh -L <порт>:127.0.0.1:<порт>, либо личный токен в ~/.iskron-bridge/token. " +
          "Тулы iskron_* поднимутся после входа сами.",
        "warning",
      );
    },
    done() {
      pending = false;
      url = null;
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
