// Окно простоя демона машины (daemon.ts): последняя сессия ушла — через окно
// демон уходит сам. Вход, ждущий клика, держит демона без сессий не дольше,
// чем держит полный мост, оставленный харнесом (session.ts): брошенный вход не
// кончается никогда, и демон с открытым портом входа жил бы вечно (граф
// nks-dev: #6620). Запись входа остаётся: следующий мост перенимает вход на той
// же ссылке, и вкладка человека, если он к ней вернётся, ещё садится (#4794).
import { pendingFlow } from "./oauth/flow.ts";
import { ORPHAN_FLOW_MS } from "./oauth/pacing.ts";
import { log } from "./streams.ts";

export interface IdleWatch {
  /** Сессий нет — завести окно простоя заново. */
  arm: () => void;
  /** Сессия пришла или демон передаёт места — окно снято. */
  hold: () => void;
}

const secs = (ms: number): number => Math.round(ms / 1000);

export function idleWatch(idleMs: number, busy: () => boolean, leave: () => void): IdleWatch {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Круг окна: всё, что заведено прежним кругом, после hold или arm молчит.
  let round = 0;
  const hold = (): void => {
    round++;
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const arm = (): void => {
    hold();
    if (busy()) return;
    const mine = round;
    timer = setTimeout(() => {
      timer = null;
      if (busy()) return;
      const flow = pendingFlow();
      if (!flow) {
        log(`no session for ${secs(idleMs)}s — the daemon leaves`);
        return leave();
      }
      // Колбэк входа слушает этот процесс: уйти сразу значило бы потерять клик человека.
      log(
        `idle, but an authorization flow is pending — staying for the human's click, at most ${secs(ORPHAN_FLOW_MS)}s`,
      );
      timer = setTimeout(() => {
        timer = null;
        if (round !== mine || busy()) return;
        log(
          `no session and the login unclicked for ${secs(ORPHAN_FLOW_MS)}s — the daemon leaves; the next bridge takes the login over on its link`,
        );
        leave();
      }, ORPHAN_FLOW_MS);
      void flow.finally(() => {
        if (round === mine) arm();
      });
    }, idleMs);
  };
  return { arm, hold };
}
