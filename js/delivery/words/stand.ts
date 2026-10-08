// Слова ответа iskron_stand (граф @nks/nks-dev, узлы #6080, #6075): русские — как
// были, английские — именами нормы #6075 (seat, the human's seat, standing).
import type { Lang } from "../lang.ts";

export interface StandWords {
  /** tail — причина промаха занятости с ведущим пробелом либо пустая строка. */
  needRealmKarta: (tail: string) => string;
  badCwd: (cwd: string, relative: boolean) => string;
  badName: (asked: string, fault: string, max: number) => string;
  cutPart: (k: string) => string;
  nameCut: (full: string, max: number, name: string, what: string) => string;
  noModel: () => string;
  legacy: (address: string, realm: string, karta: string) => string;
  boardUnread: (text: string) => string;
  /** own — заголовок доски на языке сессии, others — на прочих языках сервера (BOARD_HEADER, protocol.ts). */
  boardUnknown: (start: string, own: string, others: string) => string;
  boardAmbiguous: (n: number, name: string, karta: string) => string;
  boardCount: (declared: number, parsed: number) => string;
  boardCountFound: (declared: number, parsed: number) => string;
  refused: (what: string, text: string) => string;
  noIdInRegister: () => string;
  howBeside: (led: string) => string;
  howReturned: () => string;
  /** Место прежнего моста этой же сессии харнесса (#6706): своё — мост вернул его сам, без take от агента. */
  howOwnSession: () => string;
  /** Слушает другой держатель, а места рядом нет (#6706): подписи чужим местом без слуха не бывает. */
  otherHolder: (holder: string) => string;
  howRegister: () => string;
  ttlRefused: (ttl: number, text: string) => string;
  takenButRegister: (text: string) => string;
  howConnect: (mine: boolean, listensElsewhere: boolean, take: boolean) => string;
  head: (place: string, karta: string, realm: string, how: string) => string;
  /** Строка ответа после шапки с меткой тула. */
  note: (text: string) => string;
  noWatchdog: () => string;
  noSocket: () => string;
  besideNoDoor: () => string;
  besideHeard: () => string;
  heldAlready: () => string;
  hello: (pending: string) => string;
  noLocalSocket: (why: string) => string;
  noHello: () => string;
  knockNotHere: (room: string) => string;
  knockTwice: (room: string) => string;
  knockSent: (room: string, waited: number, window: number) => string;
  knockEarly: (room: string, waited: number, window: number) => string;
  knockNoRole: (room: string, realm: string) => string;
  knockRefused: (room: string, text: string) => string;
  knockDone: (room: string, again: boolean, text: string) => string;
  statusElsewhere: (takePath: string) => string;
  statusRefused: (body: string, guidance: string) => string;
}

const s = (ms: number): number => Math.round(ms / 1000);
const left = (window: number, waited: number): number => Math.ceil((window - waited) / 1000);

export const STAND: Readonly<Record<Lang, StandWords>> = {
  ru: {
    needRealmKarta: (tail) =>
      "Отказано (мост): iskron_stand требует realm и karta — граф и роль из AGENTS.md или строки запуска." +
      tail,
    badCwd: (cwd, relative) =>
      `Отказано (мост): cwd должен быть существующим абсолютным каталогом — получено «${cwd}»${relative ? " (относительный путь резолвился бы от cwd моста, не сессии)" : ""}.`,
    badName: (asked, fault, max) =>
      `Отказано (мост): name «${asked}» — ${fault}; правило имени: строчные латинские буквы, цифры, точка, подчёркивание, дефис, первый знак — буква или цифра, не длиннее ${max} знаков. Имя не укорачивается молча: короткое имя адресовало бы другое место.`,
    cutPart: (k) => (k === "repo" ? "репо" : k === "host" ? "машина" : "модель"),
    nameCut: (full, max, name, what) =>
      `выведенное имя ${full} длиннее предела ${max} знаков — укорочено до ${name} (срезано: ${what}); нужно другое — передай name`,
    noModel: () =>
      "model не передан — имя без третьей части (машина.репо): вторая сессия этой машины над этим репозиторием сойдётся на то же место; передай model, чтобы различать",
    legacy: (address, realm, karta) =>
      `на доске живо место прежнего имени ${address} — его адрес могут держать дела и хуки; сними его: iskron_channel(action="revoke", realm="${realm}", karta="${karta}", standing="${address}")`,
    boardUnread: (text) => `Отказано: доска не прочиталась — ${text}`,
    boardUnknown: (start, own, others) =>
      `Отказано: форма доски не распознана — ни заголовка «${own}» («${others}»), ни слова о пустом графе, ни строк мест; управляющих действий (connect, стук, хук) по догадке не делаю. Начало ответа: ${start}`,
    boardAmbiguous: (n, name, karta) =>
      `Отказано: на доске ${n} места с именем ${name} у роли #${karta} — форма неоднозначна, состояние не определить.`,
    boardCount: (declared, parsed) =>
      `Отказано: доска объявляет ${declared} мест, разобрано ${parsed}, и своего места среди разобранных нет — нераспознанная строка могла быть им — или местом, которое слушает другая сессия; connect ротировал бы его вслепую, а take=true отнял бы его. Повтори, когда доска прочтётся, либо встань под другим name.`,
    boardCountFound: (declared, parsed) =>
      `Доска объявляет ${declared} мест, разобрано ${parsed} — одну строку парсер не понял; своё место найдено, иду дальше.`,
    refused: (what, text) => `Отказано: ${what} — ${text}`,
    noIdInRegister: () =>
      "register id места не назвал — кадры места находятся по графу и адресу, занятость ждёт id.",
    howBeside: (led) =>
      `место другого графа — встаёт рядом на канале, который держит этот мост (${led}): register`,
    howReturned: () =>
      "возврат на место, с которого мост уходил, — сокет открыт заново тем же адресом, register",
    howOwnSession: () =>
      "своё место этой сессии — вернул: его держал прежний мост этой же сессии харнесса, connect (сокет теперь у этого моста, прежний получил 4000) и register",
    otherHolder: (holder) =>
      `Отказано (мост): место ${holder} слушает другой держатель — подписываться им без слуха мост не станет; встань своим местом: iskron_stand без name либо с другим name.`,
    howRegister: () => "сокет уже держит этот мост — register",
    ttlRefused: (ttl, text) =>
      `Окно простоя ${ttl} с контур не принял (${text}) — место занято с окном по умолчанию контура.`,
    takenButRegister: (text) => `Место занято, но register отказал — ${text}`,
    howConnect: (mine, listensElsewhere, take) =>
      mine
        ? listensElsewhere
          ? "место слушал другой держатель — connect по take (сокет теперь у этого моста, прежний держатель получил 4000) и register"
          : take
            ? "connect по take — новый цикл входа, счёт стуков сброшен — и register"
            : "место было — connect (сокет теперь у этого моста) и register"
        : "connect и register",
    head: (place, karta, realm, how) =>
      `[iskron_stand] стояние ${place} — роль #${karta}, граф ${realm}: ${how}.`,
    note: (text) => `[iskron_stand] ${text}`,
    noWatchdog: () =>
      "Команда сторожа не выдаётся: сокета этого места у моста ещё нет — эта сессия кадры и приглашения не принимает, пока место не вернётся.",
    noSocket: () => "Сокета у моста нет — слушать нечем; проверь ответ connect.",
    besideNoDoor: () =>
      "Место записано, но двери у него нет — сокет канала моста не жив; кадры этого графа сюда не придут.",
    besideHeard: () => "Сокет канала держит этот мост — кадры места этого графа идут его сторожу.",
    heldAlready: () => "Сокет держит этот мост (hello получен при открытии сокета).",
    hello: (pending) => `hello получен: ожидало кадров — ${pending}.`,
    noLocalSocket: (why) =>
      `НО локальный сокет стояния не поднят (${why}) — сторожу не к чему цепляться: слуха в этой сессии нет, команда сторожа выше не сработает. Место занято, записи подписаны; скажи это человеку.`,
    noHello: () =>
      "hello за 4 с не пришёл — сокет мост держит, но доказательства слуха ещё нет: проверь доску.",
    knockNotHere: (room) =>
      `Место человека ${room}: стук не отправлен — сокета этого места у моста ещё нет, ответ человека сюда не пришёл бы; постучи тем же вызовом, когда место вернётся.`,
    knockTwice: (room) =>
      `Место человека ${room}: стучал дважды, приглашения нет — больше не стучу в этом заходе; скажи человеку, что его место не ответило, и попроси открыть чат (счёт сбрасывает новый вход: take=true или новая сессия).`,
    knockSent: (room, waited, window) =>
      `Место человека ${room}: стук уже отправлен ${s(waited)} с назад — жди приглашения; осознанный повтор — тем же вызовом с repeat_knock=true, не раньше чем через ${s(window)} с.`,
    knockEarly: (room, waited, window) =>
      `Место человека ${room}: повтор рано — с первого стука прошло ${s(waited)} с, правило ждёт ${s(window)} с; повтори через ${left(window, waited)} с.`,
    knockNoRole: (room, realm) =>
      `Место человека ${room}: на доске графа ${realm} этого места нет, а send требует роль его держателя — стук не отправлен. Место человека живёт его присутствием: либо он ушёл дольше порога (попроси открыть чат и повтори), либо передай room_karta=<роль человека>.`,
    knockRefused: (room, text) => `Место человека ${room}: стук отказан — ${text}`,
    knockDone: (room, again, text) =>
      `Место человека ${room}: ${again ? "повторный " : ""}стук отправлен — ${text} Жди первого слова из места человека с шапкой; до него туда не пиши — встанешь рядом с человеком, когда оно придёт.`,
    statusElsewhere: (takePath) =>
      `Занятость не публикуется: статусного адреса этого стояния у моста нет — он у держателя сокета; ${takePath}.`,
    statusRefused: (body, guidance) => `Занятость не принята: ${body}${guidance}`,
  },
  en: {
    needRealmKarta: (tail) =>
      "Refused (bridge): iskron_stand needs realm and karta — the graph and the role from AGENTS.md or the launch line." +
      tail,
    badCwd: (cwd, relative) =>
      `Refused (bridge): cwd must be an existing absolute directory — got "${cwd}"${relative ? " (a relative path would resolve against the bridge's cwd, not the session's)" : ""}.`,
    badName: (asked, fault, max) =>
      `Refused (bridge): name "${asked}" — ${fault}; the name rule: lowercase latin letters, digits, dot, underscore, hyphen, the first sign a letter or digit, at most ${max} signs. A name is never cut silently: a shorter name would address another seat.`,
    cutPart: (k) => (k === "repo" ? "repo" : k === "host" ? "host" : "model"),
    nameCut: (full, max, name, what) =>
      `the derived name ${full} is longer than the ${max}-sign limit — cut to ${name} (dropped: ${what}); want another — pass name`,
    noModel: () =>
      "model not passed — the name has no third part (host.repo): a second session of this machine over this repository lands on the same seat; pass model to tell them apart",
    legacy: (address, realm, karta) =>
      `a seat of the former name ${address} is alive on the board — cases and hooks may hold its address; remove it: iskron_channel(action="revoke", realm="${realm}", karta="${karta}", standing="${address}")`,
    boardUnread: (text) => `Refused: the board did not read — ${text}`,
    boardUnknown: (start, own, others) =>
      `Refused: the board's form is not recognized — no «${own}» («${others}») header, no word about an empty graph, no seat lines; no controlling moves (connect, knock, hook) on a guess. The answer begins: ${start}`,
    boardAmbiguous: (n, name, karta) =>
      `Refused: the board has ${n} seats named ${name} for role #${karta} — the form is ambiguous, the state cannot be told.`,
    boardCount: (declared, parsed) =>
      `Refused: the board declares ${declared} seats, ${parsed} were read, and your own is not among them — the unread line may be it, or a seat another session listens on; connect would rotate it blind, and take=true would take it. Repeat when the board reads, or stand under another name.`,
    boardCountFound: (declared, parsed) =>
      `The board declares ${declared} seats, ${parsed} were read — the parser missed a line; your own seat is found, going on.`,
    refused: (what, text) => `Refused: ${what} — ${text}`,
    noIdInRegister: () =>
      "register did not name the seat's id — the seat's frames are found by graph and address; the busy line waits for the id.",
    howBeside: (led) =>
      `a seat of another graph — stands beside on the channel this bridge holds (${led}): register`,
    howReturned: () =>
      "back to the seat the bridge had left — the socket reopened at the same address, register",
    howOwnSession: () =>
      "this session's own seat — taken back: a former bridge of this same harness session held it, connect (the socket is now this bridge's, the former one got 4000) and register",
    otherHolder: (holder) =>
      `Refused (bridge): another holder listens on the seat ${holder} — the bridge will not sign with it without hearing; stand on your own seat: iskron_stand without name or with another name.`,
    howRegister: () => "this bridge already holds the socket — register",
    ttlRefused: (ttl, text) =>
      `The contour refused the ${ttl} s idle window (${text}) — the seat is taken with the contour's default window.`,
    takenButRegister: (text) => `The seat is taken, but register refused — ${text}`,
    howConnect: (mine, listensElsewhere, take) =>
      mine
        ? listensElsewhere
          ? "another holder listened on the seat — connect by take (the socket is now this bridge's, the former holder got 4000) and register"
          : take
            ? "connect by take — a new entry cycle, the knock count reset — and register"
            : "the seat was there — connect (the socket is now this bridge's) and register"
        : "connect and register",
    head: (place, karta, realm, how) =>
      `[iskron_stand] standing ${place} — role #${karta}, graph ${realm}: ${how}.`,
    note: (text) => `[iskron_stand] ${text}`,
    noWatchdog: () =>
      "No watchdog command: the bridge does not hold this seat's socket yet — this session takes no frames and no invitations until the seat is back.",
    noSocket: () =>
      "The bridge holds no socket — nothing to listen with; check the connect answer.",
    besideNoDoor: () =>
      "The seat is recorded, but it has no door — the bridge's channel socket is not alive; this graph's frames will not come here.",
    besideHeard: () =>
      "This bridge holds the channel socket — this graph's seat frames go to its watchdog.",
    heldAlready: () => "This bridge holds the socket (hello came when the socket opened).",
    hello: (pending) => `hello received: frames waiting — ${pending}.`,
    noLocalSocket: (why) =>
      `BUT the standing's local socket is not up (${why}) — the watchdog has nothing to attach to: no hearing in this session, the watchdog command above will not work. The seat is held, records are signed; tell the human.`,
    noHello: () =>
      "no hello within 4 s — the bridge holds the socket, but there is no proof of hearing yet: check the board.",
    knockNotHere: (room) =>
      `The human's seat ${room}: no knock sent — the bridge does not hold this seat's socket yet, the human's answer would not come here; knock with the same call once the seat is back.`,
    knockTwice: (room) =>
      `The human's seat ${room}: knocked twice, no invitation — no more knocks this time; tell the human their seat did not answer and ask them to open the chat (a new entry resets the count: take=true or a new session).`,
    knockSent: (room, waited, window) =>
      `The human's seat ${room}: a knock went ${s(waited)} s ago — wait for the invitation; a deliberate repeat — the same call with repeat_knock=true, not before ${s(window)} s.`,
    knockEarly: (room, waited, window) =>
      `The human's seat ${room}: too early to repeat — ${s(waited)} s since the first knock, the rule waits ${s(window)} s; repeat in ${left(window, waited)} s.`,
    knockNoRole: (room, realm) =>
      `The human's seat ${room}: the board of graph ${realm} does not have it, and send needs its holder's role — no knock sent. The human's seat lives by their presence: either they have been away past the threshold (ask them to open the chat and repeat), or pass room_karta=<the human's role>.`,
    knockRefused: (room, text) => `The human's seat ${room}: the knock was refused — ${text}`,
    knockDone: (room, again, text) =>
      `The human's seat ${room}: ${again ? "repeated " : ""}knock sent — ${text} Wait for the first message from the human's seat with its header; do not write there before it — you will stand beside the human when it comes.`,
    statusElsewhere: (takePath) =>
      `The busy line is not published: the bridge has no status address for this standing — the socket's holder has it; ${takePath}.`,
    statusRefused: (body, guidance) => `The busy line was not accepted: ${body}${guidance}`,
  },
};
