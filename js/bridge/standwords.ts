// Слова ответа iskron_stand (stand.ts) на языке моста (shared/lang.ts, #6080):
// русские — как были, английские — именами нормы #6075 (seat, the human's seat,
// standing). Механика — в stand.ts; здесь только слова.
import { L } from "../shared/lang.ts";
import { type StatusMiss } from "./status.ts";

const s = (ms: number): number => Math.round(ms / 1000);

/** Почему вызов со status без karta не стал одной занятостью — настоящая причина, одна. */
function missWord(m: StatusMiss, of?: string): string {
  const only = L(
    "Без karta вызов только ставит занятость места, которое ведёт этот мост",
    "Without karta the call only sets the busy line of the seat this bridge leads",
  );
  switch (m.why) {
    case "none":
      return L(
        `${only} в этом графе, — такого места нет.`,
        `${only} in this graph — there is none.`,
      );
    case "args":
      return L(
        `${only}, а вызов несёт ${m.args.join(", ")} — это занятие места; для одной занятости — только realm и status.`,
        `${only}, and the call carries ${m.args.join(", ")} — that is taking a seat; for the busy line alone — only realm and status.`,
      );
    case "name":
      return L(
        `${only}: вызов называет имя ${m.asked}, а мост держит здесь ${m.held} — назови его или опусти name.`,
        `${only}: the call names ${m.asked}, and the bridge holds ${m.held} here — name it or leave name out.`,
      );
    case "satellite":
      return L(
        `${only}: место моста — не спутник места ${of ?? "?"}.`,
        `${only}: the bridge's seat is not a satellite of ${of ?? "?"}.`,
      );
    case "cwd":
      return L(
        `${only}: каталог ${m.cwd} не существует или не абсолютный.`,
        `${only}: the directory ${m.cwd} does not exist or is not absolute.`,
      );
    case "parked":
      return L(
        `${only}, а с места этот мост ушёл словом (leave): вернись iskron_stand с karta тем же именем.`,
        `${only}, and this bridge left its seat by word (leave): return by iskron_stand with karta under the same name.`,
      );
    case "elsewhere":
      return L(
        `${only}, а сокета и статусного адреса этого места у моста нет — сокет места не у этого моста: место ждёт возврата с диска либо сокет отпущен (мёртвый токен, снятие); займи место iskron_stand с karta.`,
        `${only}, and the bridge has neither the socket nor the status address of this seat — the seat's socket is not with this bridge: the seat waits for its return from disk, or the socket was released (dead token, revoke); take the seat by iskron_stand with karta.`,
      );
  }
}

export const SW = {
  /** miss — почему вызов со status без karta не стал занятостью (status.ts); null — status не было. */
  needRealmKarta: (miss: StatusMiss | null, of?: string): string =>
    L(
      "Отказано (мост): iskron_stand требует realm и karta — граф и роль из AGENTS.md или строки запуска.",
      "Refused (bridge): iskron_stand needs realm and karta — the graph and the role from AGENTS.md or the launch line.",
    ) + (miss ? ` ${missWord(miss, of)}` : ""),
  badCwd: (cwd: string, relative: boolean): string =>
    L(
      `Отказано (мост): cwd должен быть существующим абсолютным каталогом — получено «${cwd}»${relative ? " (относительный путь резолвился бы от cwd моста, не сессии)" : ""}.`,
      `Refused (bridge): cwd must be an existing absolute directory — got "${cwd}"${relative ? " (a relative path would resolve against the bridge's cwd, not the session's)" : ""}.`,
    ),
  badName: (asked: string, fault: string, max: number): string =>
    L(
      `Отказано (мост): name «${asked}» — ${fault}; правило имени: строчные латинские буквы, цифры, точка, подчёркивание, дефис, первый знак — буква или цифра, не длиннее ${max} знаков. Имя не укорачивается молча: короткое имя адресовало бы другое место.`,
      `Refused (bridge): name "${asked}" — ${fault}; the name rule: lowercase latin letters, digits, dot, underscore, hyphen, the first sign a letter or digit, at most ${max} signs. A name is never cut silently: a shorter name would address another seat.`,
    ),
  cutPart: (k: string): string =>
    k === "repo" ? L("репо", "repo") : k === "host" ? L("машина", "host") : L("модель", "model"),
  nameCut: (full: string, max: number, name: string, what: string): string =>
    L(
      `выведенное имя ${full} длиннее предела ${max} знаков — укорочено до ${name} (срезано: ${what}); нужно другое — передай name`,
      `the derived name ${full} is longer than the ${max}-sign limit — cut to ${name} (dropped: ${what}); want another — pass name`,
    ),
  noModel: (): string =>
    L(
      "model не передан — имя без третьей части (машина.репо): вторая сессия этой машины над этим репозиторием сойдётся на то же место; передай model, чтобы различать",
      "model not passed — the name has no third part (host.repo): a second session of this machine over this repository lands on the same seat; pass model to tell them apart",
    ),
  legacy: (address: string, realm: string, karta: string): string =>
    L(
      `на доске живо место прежнего имени ${address} — его адрес могут держать дела и хуки; сними его: iskron_channel(action="revoke", realm="${realm}", karta="${karta}", standing="${address}")`,
      `a seat of the former name ${address} is alive on the board — cases and hooks may hold its address; remove it: iskron_channel(action="revoke", realm="${realm}", karta="${karta}", standing="${address}")`,
    ),
  boardUnread: (text: string): string =>
    L(`Отказано: доска не прочиталась — ${text}`, `Refused: the board did not read — ${text}`),
  boardUnknown: (start: string): string =>
    L(
      `Отказано: форма доски не распознана — ни заголовка «Каналы» («Channels»), ни слова о пустом графе, ни строк мест; управляющих действий (connect, стук, хук) по догадке не делаю. Начало ответа: ${start}`,
      `Refused: the board's form is not recognized — no «Channels» («Каналы») header, no word about an empty graph, no seat lines; no controlling moves (connect, knock, hook) on a guess. The answer begins: ${start}`,
    ),
  boardAmbiguous: (n: number, name: string, karta: string): string =>
    L(
      `Отказано: на доске ${n} места с именем ${name} у роли #${karta} — форма неоднозначна, состояние не определить.`,
      `Refused: the board has ${n} seats named ${name} for role #${karta} — the form is ambiguous, the state cannot be told.`,
    ),
  boardCount: (declared: number, parsed: number): string =>
    L(
      `Отказано: доска объявляет ${declared} мест, разобрано ${parsed}, и своего места среди разобранных нет — нераспознанная строка могла быть им; connect ротировал бы его вслепую. Уверен, что места нет, — повтори с take=true.`,
      `Refused: the board declares ${declared} seats, ${parsed} were read, and your own is not among them — the unread line may be it; connect would rotate it blind. Sure there is no seat — repeat with take=true.`,
    ),
  boardCountFound: (declared: number, parsed: number): string =>
    L(
      `Доска объявляет ${declared} мест, разобрано ${parsed} — одну строку парсер не понял; своё место найдено, иду дальше.`,
      `The board declares ${declared} seats, ${parsed} were read — the parser missed a line; your own seat is found, going on.`,
    ),
  refused: (what: string, text: string): string =>
    L(`Отказано: ${what} — ${text}`, `Refused: ${what} — ${text}`),
  noIdInRegister: (): string =>
    L(
      "register id места не назвал — кадры места находятся по графу и адресу, занятость ждёт id.",
      "register did not name the seat's id — the seat's frames are found by graph and address; the busy line waits for the id.",
    ),
  howBeside: (led: string): string =>
    L(
      `место другого графа — встаёт рядом на канале, который держит этот мост (${led}): register`,
      `a seat of another graph — stands beside on the channel this bridge holds (${led}): register`,
    ),
  howReturned: (): string =>
    L(
      "возврат на место, с которого мост уходил, — сокет открыт заново тем же адресом, register",
      "back to the seat the bridge had left — the socket reopened at the same address, register",
    ),
  howDeadPredecessor: (): string =>
    L(
      "слушающим доска ещё читает прежний мост этого каталога, а он мёртв (его сокет не отвечает, запись держания цела) — только register; как только доска его отпустит (закрытый сокет прежние серверы держали «слушающим» около минуты; с честной живостью, по слову контура, — почти сразу), тот же вызов вернёт место с диска тем же адресом — повтори",
      "the board still reads this directory's former bridge as listening, and it is dead (its socket does not answer, the holding record is intact) — register only; once the board lets it go (older servers kept a closed socket «listening» about a minute; with honest liveness, by the contour's word, almost at once) the same call returns the seat from disk at the same address — repeat it",
    ),
  /** Место прежнего моста этой же сессии харнесса (#6706): своё — мост вернул его сам, без take от агента. */
  howOwnSession: (): string =>
    L(
      "своё место этой сессии — вернул: его держал прежний мост этой же сессии харнесса, connect (сокет теперь у этого моста, прежний получил 4000) и register",
      "this session's own seat — taken back: a former bridge of this same harness session held it, connect (the socket is now this bridge's, the former one got 4000) and register",
    ),
  /** Слушает другой держатель, а места рядом нет (#6706): подписи чужим местом без слуха не бывает. */
  otherHolder: (holder: string): string =>
    L(
      `Отказано (мост): место ${holder} слушает другой держатель — подписываться им без слуха мост не станет; встань своим местом: iskron_stand без name либо с другим name.`,
      `Refused (bridge): another holder listens on the seat ${holder} — the bridge will not sign with it without hearing; stand on your own seat: iskron_stand without name or with another name.`,
    ),
  howRegister: (): string =>
    L("сокет уже держит этот мост — register", "this bridge already holds the socket — register"),
  ttlRefused: (ttl: number, text: string): string =>
    L(
      `Окно простоя ${ttl} с контур не принял (${text}) — место занято с окном по умолчанию контура.`,
      `The contour refused the ${ttl} s idle window (${text}) — the seat is taken with the contour's default window.`,
    ),
  takenButRegister: (text: string): string =>
    L(
      `Место занято, но register отказал — ${text}`,
      `The seat is taken, but register refused — ${text}`,
    ),
  howConnect: (mine: boolean, listensElsewhere: boolean, take: boolean): string =>
    mine
      ? listensElsewhere
        ? L(
            "место слушал другой держатель — connect по take (сокет теперь у этого моста, прежний держатель получил 4000) и register",
            "another holder listened on the seat — connect by take (the socket is now this bridge's, the former holder got 4000) and register",
          )
        : take
          ? L(
              "connect по take — новый цикл входа, счёт стуков сброшен — и register",
              "connect by take — a new entry cycle, the knock count reset — and register",
            )
          : L(
              "место было — connect (сокет теперь у этого моста) и register",
              "the seat was there — connect (the socket is now this bridge's) and register",
            )
      : L("connect и register", "connect and register"),
  head: (place: string, karta: string, realm: string, how: string): string =>
    L(
      `[iskron_stand] стояние ${place} — роль #${karta}, граф ${realm}: ${how}.`,
      `[iskron_stand] standing ${place} — role #${karta}, graph ${realm}: ${how}.`,
    ),
  noWatchdog: (): string =>
    L(
      "Команда сторожа не выдаётся: сокета этого места у моста ещё нет — эта сессия кадры и приглашения не принимает, пока место не вернётся.",
      "No watchdog command: the bridge does not hold this seat's socket yet — this session takes no frames and no invitations until the seat is back.",
    ),
  noSocket: (): string =>
    L(
      "Сокета у моста нет — слушать нечем; проверь ответ connect.",
      "The bridge holds no socket — nothing to listen with; check the connect answer.",
    ),
  besideNoDoor: (): string =>
    L(
      "Место записано, но двери у него нет — сокет канала моста не жив; кадры этого графа сюда не придут.",
      "The seat is recorded, but it has no door — the bridge's channel socket is not alive; this graph's frames will not come here.",
    ),
  hearingElsewhere: (): string =>
    L(
      "Слуха здесь ещё нет — повтори тот же вызов, место вернётся с диска.",
      "No hearing here yet — repeat the same call, the seat returns from disk.",
    ),
  besideHeard: (): string =>
    L(
      "Сокет канала держит этот мост — кадры места этого графа идут его сторожу.",
      "This bridge holds the channel socket — this graph's seat frames go to its watchdog.",
    ),
  heldAlready: (): string =>
    L(
      "Сокет держит этот мост (hello получен при открытии сокета).",
      "This bridge holds the socket (hello came when the socket opened).",
    ),
  hello: (pending: string): string =>
    L(
      `hello получен: ожидало кадров — ${pending}.`,
      `hello received: frames waiting — ${pending}.`,
    ),
  noLocalSocket: (why: string): string =>
    L(
      `НО локальный сокет стояния не поднят (${why}) — сторожу не к чему цепляться: слуха в этой сессии нет, команда сторожа выше не сработает. Место занято, записи подписаны; скажи это человеку.`,
      `BUT the standing's local socket is not up (${why}) — the watchdog has nothing to attach to: no hearing in this session, the watchdog command above will not work. The seat is held, records are signed; tell the human.`,
    ),
  noHello: (): string =>
    L(
      "hello за 4 с не пришёл — сокет мост держит, но доказательства слуха ещё нет: проверь доску.",
      "no hello within 4 s — the bridge holds the socket, but there is no proof of hearing yet: check the board.",
    ),
  knockNotHere: (room: string): string =>
    L(
      `Место человека ${room}: стук не отправлен — сокета этого места у моста ещё нет, ответ человека сюда не пришёл бы; постучи тем же вызовом, когда место вернётся.`,
      `The human's seat ${room}: no knock sent — the bridge does not hold this seat's socket yet, the human's answer would not come here; knock with the same call once the seat is back.`,
    ),
  knockTwice: (room: string): string =>
    L(
      `Место человека ${room}: стучал дважды, приглашения нет — больше не стучу в этом заходе; скажи человеку, что его место не ответило, и попроси открыть чат (счёт сбрасывает новый вход: take=true или новая сессия).`,
      `The human's seat ${room}: knocked twice, no invitation — no more knocks this time; tell the human their seat did not answer and ask them to open the chat (a new entry resets the count: take=true or a new session).`,
    ),
  knockSent: (room: string, waited: number, window: number): string =>
    L(
      `Место человека ${room}: стук уже отправлен ${s(waited)} с назад — жди приглашения; осознанный повтор — тем же вызовом с repeat_knock=true, не раньше чем через ${s(window)} с.`,
      `The human's seat ${room}: a knock went ${s(waited)} s ago — wait for the invitation; a deliberate repeat — the same call with repeat_knock=true, not before ${s(window)} s.`,
    ),
  knockEarly: (room: string, waited: number, window: number): string =>
    L(
      `Место человека ${room}: повтор рано — с первого стука прошло ${s(waited)} с, правило ждёт ${s(window)} с; повтори через ${Math.ceil((window - waited) / 1000)} с.`,
      `The human's seat ${room}: too early to repeat — ${s(waited)} s since the first knock, the rule waits ${s(window)} s; repeat in ${Math.ceil((window - waited) / 1000)} s.`,
    ),
  knockNoRole: (room: string, realm: string): string =>
    L(
      `Место человека ${room}: на доске графа ${realm} этого места нет, а send требует роль его держателя — стук не отправлен. Место человека живёт его присутствием: либо он ушёл дольше порога (попроси открыть чат и повтори), либо передай room_karta=<роль человека>.`,
      `The human's seat ${room}: the board of graph ${realm} does not have it, and send needs its holder's role — no knock sent. The human's seat lives by their presence: either they have been away past the threshold (ask them to open the chat and repeat), or pass room_karta=<the human's role>.`,
    ),
  knockRefused: (room: string, text: string): string =>
    L(
      `Место человека ${room}: стук отказан — ${text}`,
      `The human's seat ${room}: the knock was refused — ${text}`,
    ),
  knockDone: (room: string, again: boolean, text: string): string =>
    L(
      `Место человека ${room}: ${again ? "повторный " : ""}стук отправлен — ${text} Жди первого слова из места человека с шапкой; до него туда не пиши — встанешь рядом с человеком, когда оно придёт.`,
      `The human's seat ${room}: ${again ? "repeated " : ""}knock sent — ${text} Wait for the first message from the human's seat with its header; do not write there before it — you will stand beside the human when it comes.`,
    ),
  statusAfterDead: (): string =>
    L(
      "Занятость не публикуется: статусного адреса у моста пока нет — повтори тот же вызов, когда доска отпустит мёртвый прежний мост: место вернётся с диска вместе с ним.",
      "The busy line is not published: the bridge has no status address yet — repeat the same call when the board lets the dead former bridge go: the seat returns from disk together with it.",
    ),
  statusElsewhere: (takePath: string): string =>
    L(
      `Занятость не публикуется: статусного адреса этого стояния у моста нет — он у держателя сокета; ${takePath}.`,
      `The busy line is not published: the bridge has no status address for this standing — the socket's holder has it; ${takePath}.`,
    ),
  statusRefused: (body: string, guidance: string): string =>
    L(
      `Занятость не принята: ${body}${guidance}`,
      `The busy line was not accepted: ${body}${guidance}`,
    ),
};
