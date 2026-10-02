// Передача сокета места преемнику при смене демона (граф nks-dev: #6586, #6482).
// Сервер пишет в закрывающийся сокет, пока не прочтёт кадр закрытия, и считает
// кадр доставленным по записи — закрытый сокет терял бы слово молча. Поэтому
// уходящий демон сокет не закрывает: держит его, пока преемник не откроет тот же
// адрес и сервер не вытеснит старый кодом 4000, либо до предела; пришедшее за это
// время — в спул (spool.ts). Предел вышел — сокет закрыт, как прежде.
import { EVICTED_CODE, type Frame, type Holder } from "../shared/channel.ts";
import { spoolFilePathOf } from "../shared/standings.ts";
import { CFG } from "./config.ts";
import { closeSpool, drainSpool, HANDOFF_MS, openSpool, spoolFrame } from "./spool.ts";
import { log } from "./streams.ts";

/** Удержанные сокеты мест — процесса, не сессии: демон ждёт их всех перед уходом. */
const pending = new Set<Promise<void>>();

/** Держать сокет места до вытеснения преемником или до предела; кадры — в спул. */
function keepUntilEvicted(holder: Holder, key: string): void {
  const path = spoolFilePathOf(CFG.authDir, key);
  openSpool(path);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let over = false;
  const done = new Promise<void>((resolve) => {
    const end = (why: string): void => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      closeSpool(path);
      log(`place ${key} handed over: ${why}`);
      resolve();
    };
    timer = setTimeout(() => {
      holder.close("the successor did not take the place");
      end(`no successor took the socket in ${HANDOFF_MS / 1000}s — closed`);
    }, HANDOFF_MS);
    holder.handOff(
      (raw) => spoolFrame(path, raw),
      (code) =>
        end(
          code === EVICTED_CODE
            ? "the successor took the socket (close 4000)"
            : `the socket closed (${code})`,
        ),
    );
  });
  pending.add(done);
}

/** Отпустить сокет места: передаётся (keepFor — ключ места) — держать до вытеснения, иначе закрыть. */
export function letGo(holder: Holder | null, keepFor: string | null, reason: string): void {
  if (holder && keepFor) keepUntilEvicted(holder, keepFor);
  else holder?.close(reason);
}

/** Место держит этот держатель (hello) — дослать пришедшее уходящему демону тем же путём. */
export const takeSpool = (key: string, feed: (raw: string, frame: Frame | null) => void): void =>
  drainSpool(spoolFilePathOf(CFG.authDir, key), feed);

/** Все удержанные сокеты отпущены — вытеснены преемником или закрыты по пределу. */
export const handoffsSettled = (): Promise<void> => Promise.all([...pending]).then(() => undefined);
