// Слова моста-спутника (граф @nks/nks-dev, узлы #6002, #6080): отказы выбора места,
// заметки о нём и ограда сырого канала.
import type { Lang } from "../lang.ts";

export interface SatelliteWords {
  /** Причина неимени, когда satellite_of пуст. */
  empty: () => string;
  notSeatName: (of: string, fault: string) => string;
  noCaller: (of: string) => string;
  ambiguous: (count: number, base: string) => string;
  /** Повтор того же прогона либо параллельный прогон с той же записью моста. */
  alreadyHolds: (led: string) => string;
  nameCut: (base: string, n: number, max: number, name: string) => string;
  allTaken: (caller: string) => string;
  needSatelliteOf: () => string;
  notSatellite: () => string;
  derivesName: () => string;
  boardUnread: (text: string) => string;
  claimsUnsure: (unsure: string, name: string) => string;
  seat: (caller: string, karta: string, ttl: number) => string;
  noCallerId: (caller: string) => string;
  bypass: (action: string) => string;
  onlyOwn: (action: string, own: string, karta: string, realm: string) => string;
  /** Слово о слухе вместо команды сторожа: спутник сторожа не держит. */
  listen: (ttl: number) => string;
}

export const SATELLITE: Readonly<Record<Lang, SatelliteWords>> = {
  ru: {
    empty: () => "пусто",
    notSeatName: (of, fault) =>
      `Отказано (мост): satellite_of «${of}» — не имя места (${fault}); передай место позвавшего как печатает доска: @handle:name.`,
    noCaller: (of) =>
      `Отказано (мост): места позвавшего ${of} на доске этого графа нет — спутнику не к чему встать рядом; проверь satellite_of и граф в постановке.`,
    ambiguous: (count, base) =>
      `Отказано (мост): имя ${base} на доске носят ${count} места — передай satellite_of полным адресом @handle:name.`,
    alreadyHolds: (led) =>
      `мост уже держит ${led} — повтор этого прогона либо параллельный прогон с той же записью моста (тот же файл агента или другой с той же записью), который делит это место и потеряет его, когда первый закончит; параллельно — не больше одного прогона на запись моста`,
    nameCut: (base, n, max, name) =>
      `имя ${base}.sub-${n} длиннее предела ${max} знаков — база укорочена: ${name}`,
    allTaken: (caller) =>
      `Отказано (мост): у места ${caller} заняты все спутники .sub-1…99 — прибери погасшие места прежних прогонов.`,
    needSatelliteOf: () =>
      "Отказано (мост): это мост-спутник — он занимает только место-спутник субагента; передай satellite_of — место позвавшего (@handle:name) из постановки.",
    notSatellite: () =>
      "Отказано (мост): satellite_of — только мосту-спутнику (запись моста с --satellite в файле агента); этот мост — мост сессии, и место-спутник на нём заняло бы голос позвавшего. Субагенту без своего моста — предел: он говорит местом позвавшего и называет себя в своих строках.",
    derivesName: () =>
      "Отказано (мост): имя спутника выводит мост — name, take и room вместе с satellite_of не передаются.",
    boardUnread: (text) => `Отказано: доска не прочиталась — ${text}`,
    claimsUnsure: (unsure, name) =>
      `заявки имён спутников на этой машине выбор не удержали (${unsure}) — имя ${name} выбрано по доске: уникальность не гарантирована, мост-спутник, вставший разом, мог взять то же имя`,
    seat: (caller, karta, ttl) =>
      `место-спутник ${caller}: роль #${karta}, хука инбокса роли нет, окно простоя канала ${ttl} с, записи держания нет — место живёт прогоном`,
    noCallerId: (caller) =>
      `id места ${caller} доска не напечатала — признак спутника (satellite_of) платформе не послан: место может унаследовать недоставленную почту роли`,
    bypass: (action) =>
      `Отказано (мост-спутник): ${action} мимо iskron_stand — место этому мосту даёт только iskron_stand с satellite_of; чужое место спутник не берёт и не снимает.`,
    onlyOwn: (action, own, karta, realm) =>
      `Отказано (мост-спутник): ${action} — только своего места ${own} (роль #${karta}, граф ${realm}); место позвавшего и любое другое спутник не берёт и не снимает.`,
    listen: (ttl) =>
      `[iskron-bridge] Место-спутник: сторожа не взводи — место живёт прогоном субагента и подписывает его записи; ` +
      `с концом прогона мост уходит с места сам, канал гаснет окном простоя ${ttl} с. ` +
      `Первый ход — вход в дело, названное постановкой, и пересказ постановки первым словом в нём.`,
  },
  en: {
    empty: () => "empty",
    notSeatName: (of, fault) =>
      `Refused (bridge): satellite_of "${of}" is not a seat name (${fault}); pass the caller's seat as the board prints it: @handle:name.`,
    noCaller: (of) =>
      `Refused (bridge): the caller's seat ${of} is not on this graph's board — the satellite has nothing to stand beside; check satellite_of and the graph in the brief.`,
    ambiguous: (count, base) =>
      `Refused (bridge): ${count} seats on the board carry the name ${base} — pass satellite_of as the full address @handle:name.`,
    alreadyHolds: (led) =>
      `the bridge already holds ${led} — a repeat of this run or a parallel run with the same bridge entry (the same agent file or another with the same entry), which shares this seat and loses it when the first one ends; in parallel — no more than one run per bridge entry`,
    nameCut: (base, n, max, name) =>
      `the name ${base}.sub-${n} is longer than the ${max}-sign limit — the base is cut: ${name}`,
    allTaken: (caller) =>
      `Refused (bridge): every satellite .sub-1…99 of the seat ${caller} is taken — clear the dead seats of former runs.`,
    needSatelliteOf: () =>
      "Refused (bridge): this is a satellite bridge — it takes only a subagent's satellite seat; pass satellite_of — the caller's seat (@handle:name) from the brief.",
    notSatellite: () =>
      "Refused (bridge): satellite_of is for a satellite bridge only (a bridge entry with --satellite in the agent file); this is a session bridge, and a satellite seat on it would take the caller's voice. A subagent without a bridge of its own has a limit: it speaks as the caller's seat and names itself in its lines.",
    derivesName: () =>
      "Refused (bridge): the bridge derives the satellite's name — name, take and room do not go with satellite_of.",
    boardUnread: (text) => `Refused: the board did not read — ${text}`,
    claimsUnsure: (unsure, name) =>
      `satellite name claims on this machine did not hold the pick (${unsure}) — the name ${name} was picked by the board: uniqueness is not guaranteed, a satellite bridge standing at the same moment may have taken the same name`,
    seat: (caller, karta, ttl) =>
      `satellite seat of ${caller}: role #${karta}, no role inbox hook, channel idle window ${ttl} s, no holding record — the seat lives by the run`,
    noCallerId: (caller) =>
      `the board did not print the id of ${caller} — the satellite sign (satellite_of) was not sent to the platform: the seat may inherit the role's undelivered mail`,
    bypass: (action) =>
      `Refused (satellite bridge): ${action} bypassing iskron_stand — only iskron_stand with satellite_of gives this bridge a seat; a satellite neither takes nor releases another's seat.`,
    onlyOwn: (action, own, karta, realm) =>
      `Refused (satellite bridge): ${action} — only its own seat ${own} (role #${karta}, graph ${realm}); a satellite neither takes nor releases the caller's seat or any other.`,
    listen: (ttl) =>
      `[iskron-bridge] Satellite seat: do not arm a watchdog — the seat lives by the subagent's run and signs its records; ` +
      `when the run ends the bridge leaves the seat itself, the channel dies after the ${ttl} s idle window. ` +
      `The first move — enter the case the brief names and retell the brief as your first message in it.`,
  },
};
