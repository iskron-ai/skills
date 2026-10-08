// Слова возврата места (граф @nks/nks-dev, узел #6080): возврат, проверка слуха и
// отказы — агенту. Списки ядро склеивает само и отдаёт строкой.
import type { Lang } from "../lang.ts";

export interface ResumeWords {
  failed: () => string;
  /** pending null — hello за 4 с не пришёл. */
  returnedParked: (pending: number | null) => string;
  legacy: (n: string) => string;
  noRecord: (key: string | undefined, cwd: string | undefined) => string;
  /** Запись ушла по сроку (простой дольше 6 ч): место могло истечь у платформы и выйти из дел (#6649). */
  rejoin: () => string;
  /** foreign — ключи через ", ". */
  foreignDir: (foreign: string) => string;
  /** Запись по ключу, на которой стояла другая сессия (#6706); keys — через ", ". */
  neighbourKey: (keys: string) => string;
  /** left — ключи через ", ". */
  left: (left: string) => string;
  alreadyHolding: () => string;
  byRecord: () => string;
  otherSeat: (key: string, led: string) => string;
  liveBridge: (key: string) => string;
  noHello: (key: string) => string;
  stale: (key: string) => string;
  registerRefused: (text: string) => string;
  /** others — ключи через ", ". */
  othersInDir: (others: string) => string;
  notYours: () => string;
  /** skipped — причины через "; ". */
  nothingToReturn: (skipped: string) => string;
  noKeyNoCwd: () => string;
  noSeatNoKeyNoCwd: () => string;
  leftByWord: (key: string) => string;
  watchdogReason: () => string;
  boardUnread: (text: string) => string;
  noSeatOnBoard: () => string;
  listening: () => string;
  gaveUp: (key: string, limit: number) => string;
  deafBoard: () => string;
  /** pending null — hello за 4 с не пришёл. */
  reopened: (pending: number | null) => string;
  busyRestored: (kept: string) => string;
  busyNotRestored: (body: string) => string;
  /** Строка занятости прежнего держателя не возвращается (#6017). */
  busyForeign: () => string;
  /** busy — хвост слова о занятости (busyRestored и т. п.) либо пусто. */
  fromDisk: (pending: number, busy: string) => string;
}

const via = "iskron_stand";

export const RESUME: Readonly<Record<Lang, ResumeWords>> = {
  ru: {
    failed: () => "возврат на место не удался",
    returnedParked: (pending) =>
      pending === null
        ? "возврат на место, с которого мост уходил; hello за 4 с не пришёл"
        : `возврат на место, с которого мост уходил (ожидало кадров — ${pending})`,
    legacy: (n) => `есть место прежней сборки без сессии: ${n} — вернуть: ${via}(name="${n}")`,
    noRecord: (key, cwd) =>
      `своей записи держания ${key ? `с ключом ${key}` : `для каталога ${cwd ?? "?"}`} нет`,
    rejoin: () =>
      `место могло истечь у платформы и выйти из своих дел — после ${via} проверь iskron_case(action="mine"); пусто — войди в свои дела заново (iskron_case action="join")`,
    foreignDir: (foreign) =>
      `в каталоге лежат записи мест, на которых эта сессия не стояла (${foreign}); по одному каталогу они не берутся, место займёт ${via}`,
    neighbourKey: (keys) =>
      `на месте ${keys} стояла другая сессия — место соседа возврат не берёт; своё место займёт ${via}`,
    left: (left) =>
      `место отпущено словом держателя (leave): ${left} — само не вернётся, вернуть: ${via} тем же именем`,
    alreadyHolding: () => "мост уже держит это место",
    byRecord: () => "возврат по записи",
    otherSeat: (key, led) => `${key}: мост ведёт другое место ${led}`,
    liveBridge: (key) => `${key}: держит живой мост`,
    noHello: (key) =>
      `${key}: hello не пришёл — запись цела, сторож повторит возврат; не ждёшь — ${via}`,
    stale: (key) => `${key}: запись протухла — место займёт ${via}`,
    registerRefused: (text) => `register отказал — ${text}`,
    othersInDir: (others) => `в том же каталоге записи и других мест: ${others}`,
    notYours: () => 'место не твоё — iskron_channel(action="leave") отпустит его, канал цел',
    nothingToReturn: (skipped) => `возвращать нечего — ${skipped}`,
    noKeyNoCwd: () => "ни key, ни cwd не передан",
    noSeatNoKeyNoCwd: () => "места нет, ни key, ни cwd не передан",
    leftByWord: (key) =>
      `место ${key} отпущено словом держателя (leave) — сторож его не поднимает; вернуть: ${via} тем же именем`,
    watchdogReason: () => "сторож слуха",
    boardUnread: (text) => `доска не прочиталась — ${text}`,
    noSeatOnBoard: () => "своего места на доске нет",
    listening: () => "слушаю",
    gaveUp: (key, limit) =>
      `Искрон: доска читает место ${key} не слушающим и после ${limit} переоткрытий сокета — ` +
      `больше не рву; проверь доску и сервер, вернуть слух — ${via} тем же именем: другую сессию на месте он не тронет и встанет рядом; take=true — только словом человека.`,
    deafBoard: () => "доска не читает слушающим",
    reopened: (pending) =>
      pending === null
        ? "сокет переоткрыт, hello за 4 с не пришёл"
        : `сокет переоткрыт: ожидало кадров — ${pending}`,
    busyRestored: (kept) => `; занятость возвращена: ${kept}`,
    busyNotRestored: (body) => `; занятость не возвращена: ${body}`,
    busyForeign: () => "; прежняя строка занятости не возвращена — скажи свою",
    fromDisk: (pending, busy) =>
      `возврат места с диска после перезапуска моста — сокет открыт заново тем же адресом (ожидало кадров — ${pending})${busy}`,
  },
  en: {
    failed: () => "the return to the seat failed",
    returnedParked: (pending) =>
      pending === null
        ? "the return to the seat the bridge had left; hello did not come in 4 s"
        : `the return to the seat the bridge had left (frames waiting — ${pending})`,
    legacy: (n) =>
      `there is a seat of an earlier build without a session: ${n} — to bring it back: ${via}(name="${n}")`,
    noRecord: (key, cwd) =>
      `there is no own hold record ${key ? `with the key ${key}` : `for the directory ${cwd ?? "?"}`}`,
    rejoin: () =>
      `the seat may have expired at the platform and left its cases — after ${via} check iskron_case(action="mine"); empty — join your cases again (iskron_case action="join")`,
    foreignDir: (foreign) =>
      `the directory holds records of seats this session did not stand on (${foreign}); they are not taken by directory alone, ${via} will take the seat`,
    neighbourKey: (keys) =>
      `another session stood on the seat ${keys} — a return does not take a neighbour's seat; ${via} will take your own`,
    left: (left) =>
      `the seat was released by the holder's word (leave): ${left} — it will not return by itself, to bring it back: ${via} with the same name`,
    alreadyHolding: () => "the bridge already holds this seat",
    byRecord: () => "return by record",
    otherSeat: (key, led) => `${key}: the bridge leads another seat ${led}`,
    liveBridge: (key) => `${key}: held by a live bridge`,
    noHello: (key) =>
      `${key}: hello did not come — the record is intact, the watchdog will repeat the return; if you do not wait — ${via}`,
    stale: (key) => `${key}: the record went stale — ${via} will take the seat`,
    registerRefused: (text) => `register refused — ${text}`,
    othersInDir: (others) => `the same directory holds records of other seats too: ${others}`,
    notYours: () =>
      'the seat is not yours — iskron_channel(action="leave") will release it, the channel stays intact',
    nothingToReturn: (skipped) => `nothing to return — ${skipped}`,
    noKeyNoCwd: () => "neither key nor cwd was passed",
    noSeatNoKeyNoCwd: () => "no seat, and neither key nor cwd was passed",
    leftByWord: (key) =>
      `the seat ${key} was released by the holder's word (leave) — the watchdog does not raise it; to bring it back: ${via} with the same name`,
    watchdogReason: () => "the hearing watchdog",
    boardUnread: (text) => `the board could not be read — ${text}`,
    noSeatOnBoard: () => "the own seat is not on the board",
    listening: () => "listening",
    gaveUp: (key, limit) =>
      `Iskron: the board reads the seat ${key} as not listening and after ${limit} socket reopenings — ` +
      `I no longer tear it; check the board and the server, to restore hearing — ${via} with the same name: it leaves another session on the seat alone and stands beside; take=true — only on the human's word.`,
    deafBoard: () => "the board does not read it as listening",
    reopened: (pending) =>
      pending === null
        ? "the socket is reopened, hello did not come in 4 s"
        : `the socket is reopened: frames waiting — ${pending}`,
    busyRestored: (kept) => `; busy line restored: ${kept}`,
    busyNotRestored: (body) => `; busy line not restored: ${body}`,
    busyForeign: () => "; the former busy line is not restored — say your own",
    fromDisk: (pending, busy) =>
      `the seat returned from disk after the bridge restarted — the socket reopened at the same address (frames waiting — ${pending})${busy}`,
  },
};
