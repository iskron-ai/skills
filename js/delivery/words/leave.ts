// Слова ухода с места и возврата на него (граф @nks/nks-dev, узел #4895).
import type { Lang } from "../lang.ts";

export interface LeaveWords {
  notHolding: () => string;
  cleared: () => string;
  notCleared: (body: string) => string;
  /** keys — ключи мест канала, уже через ", ". */
  seats: (keys: string) => string;
  seat: (key: string) => string;
  leftByWord: (which: string, line: string) => string;
  left: (which: string, line: string) => string;
  satelliteReleased: () => string;
  leftSatellite: (place: string, line: string) => string;
  /** status — снятая занятость; пустая — её не было. */
  returned: (how: string, status: string) => string;
  noHello: () => string;
  watchdogAttached: () => string;
  nobodyListens: (min: number) => string;
  byDoerWord: () => string;
  /** realm — граф основного места; нет его — слово о нём. */
  refusedBeside: (beside: string, led: string, realm: string | undefined) => string;
  refusedOther: (realm: string, led: string, ledRealm: string) => string;
}

export const LEAVE: Readonly<Record<Lang, LeaveWords>> = {
  ru: {
    notHolding: () => "мост места не держит — уходить неоткуда",
    cleared: () => "занятость снята",
    notCleared: (body) => `занятость не снята (${body})`,
    seats: (keys) => `с мест ${keys} (сокет канала у них общий)`,
    seat: (key) => `с места ${key}`,
    leftByWord: (which, line) =>
      `ушёл ${which}: сокет закрыт, ${line}; адрес, очередь и хуки целы — почта копится; место отпущено словом, само не вернётся — вернуть: iskron_stand тем же именем`,
    left: (which, line) =>
      `ушёл ${which}: сокет закрыт, ${line}; адрес, очередь и хуки целы — почта копится и придёт при возвращении (сторож или iskron_stand)`,
    satelliteReleased: () => "место-спутник отпущено целиком",
    leftSatellite: (place, line) =>
      `ушёл с места-спутника ${place}: сокет закрыт, ${line}; место отпущено целиком — ни сторож, ни возврат его не поднимут; встать снова — iskron_stand с satellite_of`,
    returned: (how, status) =>
      `мост вернулся на место (${how}) — сокет открыт заново тем же адресом${status ? `, занятость «${status}» возвращена` : ""}`,
    noHello: () =>
      "сокет, открытый заново тем же адресом, не дал hello — адрес мог повернуть другой",
    watchdogAttached: () => "прицепился сторож",
    nobodyListens: (min) => `никто не слушает ${min} мин`,
    byDoerWord: () => "по слову делателя",
    refusedBeside: (beside, led, realm) =>
      `Отказано (мост): место ${beside} стоит на общем канале моста рядом с ${led} — уход закрыл бы сокет всем местам канала. Уйти со всех — leave в графе ${realm ?? "основного места"}; снять только это место — revoke.`,
    refusedOther: (realm, led, ledRealm) =>
      `Отказано (мост): в графе ${realm} этот мост места не держит — уходить неоткуда; его место ${led} в графе ${ledRealm} не тронуто.`,
  },
  en: {
    notHolding: () => "the bridge holds no seat — nothing to leave",
    cleared: () => "busyness cleared",
    notCleared: (body) => `busyness not cleared (${body})`,
    seats: (keys) => `the seats ${keys} (they share the channel socket)`,
    seat: (key) => `the seat ${key}`,
    leftByWord: (which, line) =>
      `left ${which}: the socket is closed, ${line}; address, queue and hooks intact — mail piles up; the seat is released by word and will not return by itself — to bring it back: iskron_stand with the same name`,
    left: (which, line) =>
      `left ${which}: the socket is closed, ${line}; address, queue and hooks intact — mail piles up and arrives on return (the watchdog or iskron_stand)`,
    satelliteReleased: () => "the satellite seat is released whole",
    leftSatellite: (place, line) =>
      `left the satellite seat ${place}: the socket is closed, ${line}; the seat is released whole — neither the watchdog nor a return will raise it; to stand again — iskron_stand with satellite_of`,
    returned: (how, status) =>
      `the bridge is back on the seat (${how}) — the socket is reopened at the same address${status ? `, busyness "${status}" restored` : ""}`,
    noHello: () =>
      "the socket reopened at the same address gave no hello — another may have turned the address",
    watchdogAttached: () => "a watchdog attached",
    nobodyListens: (min) => `nobody has listened for ${min} min`,
    byDoerWord: () => "by the doer's word",
    refusedBeside: (beside, led, realm) =>
      `Refused (bridge): the seat ${beside} stands on the bridge's shared channel beside ${led} — leaving would close the socket for all seats of the channel. To leave all — leave in the graph ${realm ?? "of the main seat"}; to remove only this seat — revoke.`,
    refusedOther: (realm, led, ledRealm) =>
      `Refused (bridge): this bridge holds no seat in the graph ${realm} — nothing to leave; its seat ${led} in the graph ${ledRealm} is untouched.`,
  },
};
