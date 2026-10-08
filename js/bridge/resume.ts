// Возврат места с диска (граф nks-dev: #5061, #5140): мост, поднятый заново —
// перезапуск плагина, вытеснение каталога OpenCode, /mcp reconnect — берёт
// место по записи держания, а не ротирует его connect-ом. Две двери:
//   • по имени — iskron_stand (stand.ts) зовёт resumeFromDisk;
//   • по ключу или каталогу сессии — запрос плагина `iskron/resume {key?, cwd?, session?}`:
//     мост находит СВОЮ запись (тот же харнесс; тот же ключ без другой сессии
//     на нём — либо тот же каталог И та же сессия, что на месте стояла), открывает сокет,
//     регистрируется и отвечает, сколько кадров ожидало. Чужого харнесса запись
//     не трогается: Claude Code, вставший в той же копии, не теряет места от
//     плагина OpenCode. Сессия, не стоявшая на месте, по одному каталогу его не
//     получает (#6017), а строка занятости прежнего держателя не публикуется
//     заново: это его слово о его работе, и свежая отметка выдала бы её за текущую.
// `iskron/check {key?, cwd?}` — сторож плагина: держим — доска; не слушает →
// сокет переоткрывается; запарковано → возврат на место; не ведём — возврат.
// Мост, ведущий другое место (держит или запарковал), чужой записью не
// занимается: holdStanding иного ключа убил бы ведомое.
import { L } from "../shared/lang.ts";
import { envOf, scoped } from "../shared/scope.ts";
import { listens, nameOf, readBoard, undelivered } from "./board.ts";
import { callTool, short } from "./call.ts";
import { CFG } from "./config.ts";
import { localHolder } from "./hearing.ts";
import {
  awaitHello,
  holdsKey,
  holdStanding,
  isParked,
  ledKey,
  localSocketPathOf,
  noteResuming,
  noteStandCwd,
  parkStanding,
  releaseStanding,
  rememberStatus,
  resumeStanding,
} from "./hold.ts";
import { signHeldRecord } from "./holdkeep.ts";
import {
  type HoldRecord,
  keyOf,
  noteHarnessSession,
  noteSeatBase,
  readHoldRecord,
  restoreHoldRecord,
  sessionOfBridge,
} from "./holdrecord.ts";
import { holdWords } from "./holdwords.ts";
import { returnToStanding } from "./leave.ts";
import { THIN_RESUME_ID } from "./lostplaces.ts";
import { placeFields } from "./placefields.ts";
import { recordsFor, type ResumeSelector } from "./resumepick.ts";
import { resumeWords } from "./resumewords.ts";
import { publishStatus } from "./status.ts";
import { standingLog } from "./store.ts";
import { emit, log } from "./streams.ts";
import { afterResume } from "./suspend.ts";
import { localSocketAlive } from "./sweep.ts";
import { state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

/** Возврат не нашёл записи названного места (ушла по сроку): следующий iskron_stand это напомнит (#6649). */
const RJ = scoped(() => ({ lapsed: false }));
export function takeLapsed(): boolean {
  const was = RJ.lapsed;
  RJ.lapsed = false;
  return was;
}

/**
 * Вернуть с диска место, которое держал прежний мост этого каталога (#5061):
 * только когда его локальный сокет мёртв (живой держатель — не наше место) и
 * мост не ведёт другого места. Слух доказывается свежим hello; мёртвый токен —
 * протухшая запись, стирается тихо, и место занимается заново connect-ом.
 * Строка занятости из записи возвращается, только если возвращается та же
 * сессия, что её сказала; иначе она не публикуется и из записи стирается
 * (#6017): это слово прежнего держателя, и опубликованная заново она читалась
 * бы с доски сказанной сейчас. Возвращает слово об исходе или null, когда
 * возвращать нечего.
 */
export async function resumeFromDisk(
  realm: string,
  karta: string | number,
  name: string,
): Promise<{ word: string; pending: number } | null> {
  const key = keyOf(realm, karta, name);
  const rec = readHoldRecord(key);
  if (!rec) return null;
  if (holdsKey(key)) return null;
  const led = ledKey();
  if (led && led !== key) return null; // ведём другое место — его сокет и ключ не наша жертва
  if (await localSocketAlive(localSocketPathOf(key))) return null; // держит живой мост — не наше
  const prev = state.standing;
  state.standing = { realm, karta, name };
  const prevCwd = rec.cwd ? noteStandCwd(rec.cwd) : null;
  if (rec.base) noteSeatBase(key, rec.base); // запись нового держателя после отъёма её уже не скажет
  noteResuming(1);
  try {
    holdStanding(rec.url, rec.statusUrl);
    const hello = await awaitHello(4000);
    if (hello && holdsKey(key)) {
      const pending = Number(hello.pending) || 0;
      const me = sessionOfBridge();
      let busy = "";
      if (rec.status && me && rec.session === me) {
        // Своя строка той же сессии (например, снятая сторожем глухоты) — обратно.
        const st = await publishStatus(rec.status);
        const kept = st.doing ?? rec.status; // легла строка из ответа, не из записи (дело №234 [139])
        busy = st.ok
          ? L(`; занятость возвращена: ${kept}`, `; busy line restored: ${kept}`)
          : L(
              `; занятость не возвращена: ${short(st.body)}`,
              `; busy line not restored: ${short(st.body)}`,
            );
      } else if (rec.status) {
        rememberStatus(""); // строка прежнего держателя — не наша: в записи её больше нет
        busy = L(
          "; прежняя строка занятости не возвращена — скажи свою",
          "; the former busy line is not restored — say your own",
        );
      }
      log(`standing resumed from disk (${key}), pending ${pending}`);
      standingLog(`resumed-from-disk ${key}: pending ${pending}`);
      return {
        word: L(
          `возврат места с диска после перезапуска моста — сокет открыт заново тем же адресом (ожидало кадров — ${pending})${busy}`,
          `the seat returned from disk after the bridge restarted — the socket reopened at the same address (frames waiting — ${pending})${busy}`,
        ),
        pending,
      };
    }
  } finally {
    noteResuming(-1);
  }
  // Мёртвый токен запись уже стёр (onDeadToken при возврате); не пришедший за
  // 4 с hello — не приговор месту: запись цела, и сторож повторит возврат, а
  // iskron_stand тем же именем перепишет её своим connect. holdStanding выше
  // переписал её со свежим at — она возвращается прежней, иначе каждая
  // неудачная попытка продлевала бы ей жизнь бессрочно.
  const onDisk = readHoldRecord(key);
  const kept = onDisk !== null;
  log(
    kept
      ? `hold record for ${key}: no hello in time — record kept as it was, the place is not taken`
      : `hold record for ${key} is stale — dropped, the place is taken anew`,
  );
  releaseStanding(holdWords.resumeFailed());
  // Только та самая запись: иной адрес на диске значит, что место за это время
  // занял другой путь (connect этого моста, второй мост на том же каталоге), и
  // его свежую запись прежняя не перекрывает.
  if (onDisk?.url === rec.url) restoreHoldRecord(key, rec);
  state.standing = prev; // память о прежнем имени цела: ничего вместо неё не занято
  if (rec.cwd) noteStandCwd(prevCwd); // иначе следующий голый connect вписал бы чужой каталог в запись другого места
  return null;
}

/**
 * Взять своё место тем же ходом, что iskron_stand по его имени (stand.ts передаёт его
 * сюда, чтобы не замкнуть импорты): возвращает первую строку ответа.
 */
type TakeOwn = (rec: HoldRecord, cwd: string | undefined) => Promise<string>;
const T: { takeOwn: TakeOwn | null } = { takeOwn: null };
export function wireTakeOwn(fn: TakeOwn): void {
  T.takeOwn = fn;
}

/** Слово о записях прежней сборки без сессии: по каталогу не возвращаются, возвращаются по имени. */
export const legacyWord = (names: string[]): string =>
  names.map((n) => resumeWords.legacy(n)).join("; ");

/**
 * Места прежней сборки, которые можно предложить вернуть: сокет места не держит
 * живой мост другой сессии (#6594). Занятое живым соседом не предлагается —
 * вызов с его именем дал бы только атрибуцию без слуха.
 */
async function freeLegacy(recs: HoldRecord[]): Promise<string[]> {
  const free: string[] = [];
  for (const r of recs) {
    const key = keyOf(r.realm, r.karta, r.name);
    if (!holdsKey(key) && (await localSocketAlive(localSocketPathOf(key)))) continue;
    free.push(r.name);
  }
  return free;
}

export interface ResumeOutcome {
  resumed: boolean;
  key?: string;
  pending?: number;
  word: string;
  /**
   * Другие записи держания того же каталога (ключи): каталог не различает
   * стояний одной роли в одной рабочей копии, возврат берёт запись этой сессии —
   * агент сверяет занятое имя с выведенным для своей сессии (граф nks-dev: #5366).
   */
  others?: string[];
  /** Имена мест прежней сборки без сессии в каталоге: не возвращены — названы, чтобы их вернули по имени. */
  legacy?: string[];
  /** Свои места, чей сокет держит живой мост другой сессии: не взяты, и сессии нужно слово (#6626). */
  elsewhere?: string[];
}

/** Обратно на запаркованное место (leave, переоткрытие): сокет заново, hello — доказательство. */
async function backToParked(key: string, how: string): Promise<ResumeOutcome> {
  if (!returnToStanding(how)) return { resumed: false, key, word: resumeWords.failed() };
  const hello = await awaitHello(4000);
  return {
    resumed: true,
    key,
    pending: Number(hello?.pending) || 0,
    word: resumeWords.returnedParked(hello ? Number(hello.pending) || 0 : null),
  };
}

/**
 * Возврат места по ключу или каталогу сессии: своя запись → сокет заново тем же
 * адресом, register (атрибуция записей), занятость обратно. Уже держим —
 * «держу»; запарковано — обратно на место; сокет держит прежний мост этой же
 * сессии — `takeOwn` (возврат нового моста) берёт ходом iskron_stand, сторож слуха
 * моста, место потерявшего, — нет: сессию уже слышат, и два её моста перетягивали
 * бы место каждым тактом; чужое или ведём другое — не трогаем.
 */
export async function resumeBy(
  sel: ResumeSelector,
  register = true,
  takeOwn = false,
): Promise<ResumeOutcome> {
  const { own: recs, sameDir, legacy: legacyRecs, left, neighbour } = recordsFor(sel);
  if (!recs.length) {
    const legacy = await freeLegacy(legacyRecs);
    const said = [resumeWords.noRecord(sel.key, sel.cwd)];
    if (neighbour.length) said.push(resumeWords.neighbourKey(neighbour));
    else if (sel.key) {
      // Ключ назван — место держалось; записи нет — она ушла по сроку (#6649).
      said.push(resumeWords.rejoin());
      RJ.lapsed = true;
    }
    const foreign = sameDir.filter((k) => !left.includes(k));
    if (foreign.length) said.push(resumeWords.foreignDir(foreign));
    if (left.length) said.push(resumeWords.left(left));
    if (legacy.length) said.push(legacyWord(legacy));
    return {
      resumed: false,
      word: said.join(" — "),
      ...(legacy.length ? { legacy } : {}),
    };
  }
  const led = ledKey();
  const skipped: string[] = [];
  const elsewhere: string[] = [];
  for (const rec of recs) {
    const key = keyOf(rec.realm, rec.karta, rec.name);
    if (holdsKey(key))
      return { resumed: true, key, pending: 0, word: resumeWords.alreadyHolding() };
    if (isParked(rec.realm, rec.karta, rec.name)) return backToParked(key, resumeWords.byRecord());
    if (led && led !== key) {
      skipped.push(resumeWords.otherSeat(key, led));
      continue;
    }
    // Чей живой сокет — суждение iskron_stand (hearing.ts): прежний мост этой же сессии —
    // место её, и оно берётся тем же ходом, что iskron_stand, без take (#6702).
    const holder = await localHolder(key, sel.cwd ?? rec.cwd);
    if (holder === "session" && takeOwn && !CFG.satellite && T.takeOwn) {
      const said = await T.takeOwn(rec, sel.cwd ?? rec.cwd);
      const now = ledKey();
      if (now && holdsKey(now)) {
        const hello = await awaitHello(4000);
        return { resumed: true, key: now, pending: Number(hello?.pending) || 0, word: said };
      }
      skipped.push(resumeWords.ownNotTaken(key, short(said)));
      continue;
    }
    if (holder) {
      skipped.push(resumeWords.liveBridge(key));
      elsewhere.push(key);
      continue;
    }
    const back = await resumeFromDisk(rec.realm, rec.karta, rec.name);
    if (!back) {
      const kept = readHoldRecord(key);
      skipped.push(kept ? resumeWords.noHello(key) : resumeWords.stale(key));
      if (!kept) {
        skipped.push(resumeWords.rejoin()); // протухшая запись — место у платформы мертво (#6649)
        RJ.lapsed = true;
      }
      continue;
    }
    const lines = [back.word];
    if (register) {
      const r = await callTool("iskron_channel", {
        action: "register",
        realm: rec.realm,
        karta: rec.karta,
        name: rec.name,
        ...placeFields(rec),
      });
      lines.push(r.isError ? resumeWords.registerRefused(short(r.text)) : "register");
    }
    // Записи, которые цикл выше признал протухшими, уже стёрты — их не называть.
    const others = [
      ...new Set([...recs.map((r) => keyOf(r.realm, r.karta, r.name)), ...sameDir]),
    ].filter((k) => k !== key && readHoldRecord(k) !== null);
    if (others.length) lines.push(resumeWords.othersInDir(others));
    // Взятое не своё — отпустить, не кончая канала: revoke места, основавшего канал, платформа отвергает.
    lines.push(resumeWords.notYours());
    return { resumed: true, key, pending: back.pending, word: lines.join("; "), others };
  }
  return {
    resumed: false,
    word: resumeWords.nothingToReturn(skipped),
    ...(elsewhere.length ? { elsewhere } : {}),
  };
}

/** Старт моста: сокет из окружения без connect — отладочный путь. */
export function holdFromEnv(): void {
  const url = envOf("ISKRON_CHANNEL_SOCKET")?.trim();
  if (url) holdStanding(url, envOf("ISKRON_CHANNEL_STATUS")?.trim() || null);
}

const reply = (msg: JsonRpcMessage, result: unknown): JsonRpcMessage => ({
  jsonrpc: "2.0",
  id: msg.id,
  result,
});

const selectorOf = (msg: JsonRpcMessage): ResumeSelector => ({
  key:
    typeof msg.params?.key === "string" && msg.params.key.trim()
      ? msg.params.key.trim()
      : undefined,
  cwd:
    typeof msg.params?.cwd === "string" && msg.params.cwd.trim()
      ? msg.params.cwd.trim()
      : undefined,
  session:
    typeof msg.params?.session === "string" && msg.params.session.trim()
      ? msg.params.session.trim()
      : undefined,
});

/** Селектор запроса плагина; названная сессия — сессия этого моста, её несут его записи держания. */
function selectorFrom(msg: JsonRpcMessage): ResumeSelector {
  const sel = selectorOf(msg);
  noteHarnessSession(sel.session);
  signHeldRecord();
  return sel;
}

export const isResumeCall = (msg: JsonRpcMessage): boolean => msg?.method === "iskron/resume";
export const isCheckCall = (msg: JsonRpcMessage): boolean => msg?.method === "iskron/check";

/**
 * `iskron/resume {key?, cwd?, session?}` — запрос плагина: вернуть своё место с диска.
 * Место у живого прежнего моста своей сессии берёт только возврат плагина, не тонкого
 * моста после смены демона (lostplaces.ts).
 */
export async function runResume(msg: JsonRpcMessage): Promise<JsonRpcMessage> {
  const sel = selectorFrom(msg);
  if (!sel.key && !sel.cwd) return reply(msg, { resumed: false, word: resumeWords.noKeyNoCwd() });
  const replay = typeof msg.id === "string" && msg.id.startsWith(THIN_RESUME_ID);
  const r = await resumeBy(sel, true, !replay);
  if (r.resumed) afterResume(r.key); // спутник после паузы принимает дела прогона (suspend.ts)
  return reply(msg, r);
}

/**
 * `iskron/check {key?, cwd?}` — сторож плагина раз в N минут: держим место —
 * доска; не слушает — сокет переоткрывается (hello с pending откроет пачку
 * побудки); запарковано — обратно; не ведём — возврат по записи.
 */
export async function runCheck(msg: JsonRpcMessage): Promise<JsonRpcMessage> {
  const sel = selectorFrom(msg);
  const s = state.standing;
  const key = s ? keyOf(s.realm, s.karta, s.name ?? "") : null;
  if (!s || !key || !holdsKey(key)) {
    if (s && key && isParked(s.realm, s.karta, s.name ?? "")) {
      // Ушёл словом (leave) — уход держится: сторож место не поднимает (#6017).
      if (readHoldRecord(key)?.left)
        return reply(msg, {
          holding: false,
          resumed: false,
          key,
          word: resumeWords.leftByWord(key),
        });
      const r = await backToParked(key, resumeWords.watchdogReason());
      return reply(msg, { holding: r.resumed, ...r });
    }
    if (!sel.key && !sel.cwd)
      return reply(msg, {
        holding: false,
        resumed: false,
        word: resumeWords.noSeatNoKeyNoCwd(),
      });
    const r = await resumeBy(sel);
    return reply(msg, { holding: r.resumed, ...r });
  }
  const board = await callTool("iskron_channel", { action: "list", realm: s.realm });
  if (board.isError)
    return reply(msg, { holding: true, key, word: resumeWords.boardUnread(short(board.text)) });
  const mine = readBoard(board).entries.find(
    (e) => e.karta === String(s.karta) && nameOf(e.address) === (s.name ?? ""),
  );
  if (!mine) return reply(msg, { holding: true, key, word: resumeWords.noSeatOnBoard() });
  const pending = undelivered(mine);
  const listening = listens(mine);
  if (listening) {
    D.reopens = 0; // слух вернулся — счёт переоткрытий с начала
    return reply(msg, { holding: true, key, listening, pending, word: resumeWords.listening() });
  }
  // Сокет у моста жив, а доска нас не слышит: переоткрыть тем же адресом. Счётчик
  // «не доставлено N» — только слово в ответе, решает признак слуха. Тормоз:
  // два переоткрытия подряд не вернули слух — третьего нет, слово вслух вместо
  // него (иначе каждый такт сторожа рвал бы живой сокет бесконечно).
  if (D.reopens >= REOPEN_LIMIT) {
    const text = resumeWords.gaveUp(key, REOPEN_LIMIT);
    if (!D.said) {
      D.said = true;
      standingLog(`reopen ${key}: gave up after ${REOPEN_LIMIT} — board still reads deaf`);
      emit({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: { level: "warning", logger: "iskron-channel", data: { kind: "lost", text } },
      });
    }
    return reply(msg, {
      holding: true,
      key,
      listening,
      pending,
      reopened: false,
      stuck: true,
      word: text,
    });
  }
  D.reopens++;
  standingLog(`reopen ${key}: board reads deaf${pending ? ` with ${pending} pending` : ""}`);
  parkStanding(resumeWords.deafBoard());
  resumeStanding();
  const hello = await awaitHello(4000);
  return reply(msg, {
    holding: true,
    key,
    listening,
    pending,
    reopened: !!hello,
    word: resumeWords.reopened(hello ? Number(hello.pending) || 0 : null),
  });
}

/** Переоткрытий подряд при доске, читающей место глухим; предел — REOPEN_LIMIT, дальше слово вслух. */
const D = scoped(() => ({ reopens: 0, said: false }));
const REOPEN_LIMIT = 2;
