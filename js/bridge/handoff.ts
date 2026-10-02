// Передача сокета места преемнику при смене демона (граф nks-dev: #6586, #6482).
// Сервер пишет в закрывающийся сокет, пока не прочтёт кадр закрытия, и считает
// кадр доставленным по записи — закрытый сокет терял бы слово молча. Поэтому
// уходящий демон сокет не закрывает: держит его, пока преемник не откроет тот же
// адрес и сервер не вытеснит старый кодом 4000, либо до предела; пришедшее за это
// время — в спул (spool.ts). Предел вышел — сокет закрыт, как прежде, и занятость снята.
import { EVICTED_CODE, type Frame, type Holder } from "../shared/channel.ts";
import { spoolFilePathOf } from "../shared/standings.ts";
import { CFG } from "./config.ts";
import { type ChannelEvent } from "./door.ts";
import { type Place, strayOf } from "./places.ts";
import { closeSpool, drainSpool, HANDOFF_MS, openSpool, spoolFrame } from "./spool.ts";
import { publishStatusTo } from "./statuspost.ts";
import { emit, log } from "./streams.ts";

/** Удержанные сокеты мест — процесса, не сессии: демон ждёт их всех перед уходом. */
const pending = new Set<Promise<void>>();

/** Держать сокет места до вытеснения преемником или до предела; кадры — в спул. */
function keepUntilEvicted(holder: Holder, key: string, statusUrl: string | null): void {
  const path = spoolFilePathOf(CFG.authDir, key);
  openSpool(path);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let over = false;
  const done = new Promise<void>((resolve) => {
    const end = (why: string, after?: Promise<unknown>): void => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      closeSpool(path);
      log(`place ${key} handed over: ${why}`);
      void Promise.resolve(after).then(() => resolve());
    };
    timer = setTimeout(() => {
      // Преемник не взял место — возвращать его некому (тонкий мост умер следом,
      // SIGTERM обоим): занятость — слово ушедшего, уходит с местом (#5059).
      // Вернётся мост позже — возврат по записи держания поднимет её снова.
      const cleared = statusUrl ? publishStatusTo(statusUrl, "", 3000).catch(() => {}) : undefined;
      end(
        `no successor took the socket in ${HANDOFF_MS / 1000}s — closed${cleared ? ", busy line cleared" : ""}`,
        cleared,
      );
      holder.close("the successor did not take the place");
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

/**
 * Отпустить сокет места: передаётся (keepFor — ключ места) — держать до вытеснения,
 * иначе закрыть. `statusUrl` — занятость места, снимаемая, если преемник не пришёл.
 */
export function letGo(
  holder: Holder | null,
  keepFor: string | null,
  reason: string,
  statusUrl: string | null = null,
): void {
  if (holder && keepFor) keepUntilEvicted(holder, keepFor, statusUrl);
  else holder?.close(reason);
}

/**
 * Место держит этот держатель (hello) — дослать пришедшее уходящему демону тем же
 * путём. Кадр места, которого мост не держит (место рядом не вернулось), основному
 * месту его кадром не отдаётся и в его .seen не метится — слово с адресатом и кадром.
 */
export function takeSpool(
  key: string,
  primary: () => Place | null,
  feed: (raw: string, frame: Frame | null) => void,
): void {
  drainSpool(spoolFilePathOf(CFG.authDir, key), (raw, frame) => {
    const p = primary();
    const to = p && strayOf(frame, p);
    if (!p || !to) return feed(raw, frame);
    const text =
      `ДЕЛАТЕЛЬ: кадр ${String(frame?.id ?? "?")} из спула смены демона адресован месту ${to}, ` +
      `не вернувшемуся, — не кадр места ${p.door.key}; вернуть место — iskron_stand в его графе. Кадр: ${raw}`;
    log(text);
    const ev: ChannelEvent = { kind: "note", text };
    p.door.broadcast(ev);
    emit({
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { level: "info", logger: "iskron-channel", data: ev },
    });
  });
}

/** Все удержанные сокеты отпущены — вытеснены преемником или закрыты по пределу. */
export const handoffsSettled = (): Promise<void> => Promise.all([...pending]).then(() => undefined);
