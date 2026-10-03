// Слова возврата места (resume.ts) на языке поставки (граф nks-dev: #6080): то, что
// возврат, проверка слуха и отказы говорят агенту. Функции, не константы — язык
// мост ставит при старте, после загрузки модулей.
import { L } from "../shared/lang.ts";

const via = "iskron_stand";

export const resumeWords = {
  releaseFailed: (): string => L("возврат с диска не удался", "the return from disk failed"),
  failed: (): string => L("возврат на место не удался", "the return to the seat failed"),
  returnedParked: (pending: number | null): string =>
    pending === null
      ? L(
          "возврат на место, с которого мост уходил; hello за 4 с не пришёл",
          "the return to the seat the bridge had left; hello did not come in 4 s",
        )
      : L(
          `возврат на место, с которого мост уходил (ожидало кадров — ${pending})`,
          `the return to the seat the bridge had left (frames waiting — ${pending})`,
        ),
  legacy: (n: string): string =>
    L(
      `есть место прежней сборки без сессии: ${n} — вернуть: ${via}(name="${n}")`,
      `there is a seat of an earlier build without a session: ${n} — to bring it back: ${via}(name="${n}")`,
    ),
  noRecord: (key: string | undefined, cwd: string | undefined): string =>
    L(
      `своей записи держания ${key ? `с ключом ${key}` : `для каталога ${cwd ?? "?"}`} нет`,
      `there is no own hold record ${key ? `with the key ${key}` : `for the directory ${cwd ?? "?"}`}`,
    ),
  foreignDir: (foreign: string[]): string =>
    L(
      `в каталоге лежат записи мест, на которых эта сессия не стояла (${foreign.join(", ")}); по одному каталогу они не берутся, место займёт ${via}`,
      `the directory holds records of seats this session did not stand on (${foreign.join(", ")}); they are not taken by directory alone, ${via} will take the seat`,
    ),
  left: (left: string[]): string =>
    L(
      `место отпущено словом держателя (leave): ${left.join(", ")} — само не вернётся, вернуть: ${via} тем же именем`,
      `the seat was released by the holder's word (leave): ${left.join(", ")} — it will not return by itself, to bring it back: ${via} with the same name`,
    ),
  alreadyHolding: (): string =>
    L("мост уже держит это место", "the bridge already holds this seat"),
  byRecord: (): string => L("возврат по записи", "return by record"),
  otherSeat: (key: string, led: string): string =>
    L(`${key}: мост ведёт другое место ${led}`, `${key}: the bridge leads another seat ${led}`),
  liveBridge: (key: string): string =>
    L(`${key}: держит живой мост`, `${key}: held by a live bridge`),
  noHello: (key: string): string =>
    L(
      `${key}: hello не пришёл — запись цела, сторож повторит возврат; не ждёшь — ${via}`,
      `${key}: hello did not come — the record is intact, the watchdog will repeat the return; if you do not wait — ${via}`,
    ),
  stale: (key: string): string =>
    L(
      `${key}: запись протухла — место займёт ${via}`,
      `${key}: the record went stale — ${via} will take the seat`,
    ),
  registerRefused: (text: string): string =>
    L(`register отказал — ${text}`, `register refused — ${text}`),
  othersInDir: (others: string[]): string =>
    L(
      `в том же каталоге записи и других мест: ${others.join(", ")}`,
      `the same directory holds records of other seats too: ${others.join(", ")}`,
    ),
  notYours: (): string =>
    L(
      'место не твоё — iskron_channel(action="leave") отпустит его, канал цел',
      'the seat is not yours — iskron_channel(action="leave") will release it, the channel stays intact',
    ),
  nothingToReturn: (skipped: string[]): string =>
    L(`возвращать нечего — ${skipped.join("; ")}`, `nothing to return — ${skipped.join("; ")}`),
  noKeyNoCwd: (): string => L("ни key, ни cwd не передан", "neither key nor cwd was passed"),
  noSeatNoKeyNoCwd: (): string =>
    L("места нет, ни key, ни cwd не передан", "no seat, and neither key nor cwd was passed"),
  leftByWord: (key: string): string =>
    L(
      `место ${key} отпущено словом держателя (leave) — сторож его не поднимает; вернуть: ${via} тем же именем`,
      `the seat ${key} was released by the holder's word (leave) — the watchdog does not raise it; to bring it back: ${via} with the same name`,
    ),
  watchdogReason: (): string => L("сторож слуха", "the hearing watchdog"),
  boardUnread: (text: string): string =>
    L(`доска не прочиталась — ${text}`, `the board could not be read — ${text}`),
  noSeatOnBoard: (): string => L("своего места на доске нет", "the own seat is not on the board"),
  listening: (): string => L("слушаю", "listening"),
  gaveUp: (key: string, limit: number): string =>
    L(
      `Искрон: доска читает место ${key} не слушающим и после ${limit} переоткрытий сокета — ` +
        `больше не рву; проверь доску и сервер, вернуть слух — ${via} с take=true.`,
      `Iskron: the board reads the seat ${key} as not listening and after ${limit} socket reopenings — ` +
        `I no longer tear it; check the board and the server, to restore hearing — ${via} with take=true.`,
    ),
  deafBoard: (): string =>
    L("доска не читает слушающим", "the board does not read it as listening"),
  reopened: (pending: number | null): string =>
    pending === null
      ? L(
          "сокет переоткрыт, hello за 4 с не пришёл",
          "the socket is reopened, hello did not come in 4 s",
        )
      : L(
          `сокет переоткрыт: ожидало кадров — ${pending}`,
          `the socket is reopened: frames waiting — ${pending}`,
        ),
};
