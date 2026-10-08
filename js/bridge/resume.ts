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
// `iskron/check {key?, cwd?}` — сторож плагина: держим — доска; не слушает → сокет переоткрывается; запарковано → возврат на место; не ведём — возврат.
// Мост, ведущий другое место (держит или запарковал), чужой записью не
// занимается: holdStanding иного ключа убил бы ведомое.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { envName, LOGGERS, method, tool } from "../delivery/index.ts";
import { sameDir as oneDir } from "../shared/canon.ts";
import { L } from "../shared/lang.ts";
import { envOf, scoped } from "../shared/scope.ts";
import { standingsDirOf } from "../shared/standings.ts";
import { listens, nameOf, readBoard, undelivered } from "./board.ts";
import { callTool, short } from "./call.ts";
import { harnessName } from "./client.ts";
import { CFG } from "./config.ts";
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
import { placeFields } from "./placefields.ts";
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

export interface ResumeSelector {
  /** ключ стояния — предпочтение: точный адрес записи */
  key?: string;
  /** каталог сессии — откат: записи этого харнесса из этого каталога, стоявшие этой сессией, свежайшая первой */
  cwd?: string;
  /** сессия харнесса, чей это мост: по каталогу своей записью считается только стоявшая ею (#6017) */
  session?: string;
}

/**
 * Свои записи держания под выбором — тот же харнесс; по ключу первой, затем по
 * каталогу, свежайшая первой. Ключ — предпочтение, каталог — откат, не «или»:
 * устаревший ключ (мост убит между released и held, подсказка из маркера) не
 * должен глушить живую запись того же каталога.
 * «Своя» по каталогу — только запись, на которой стояла ЭТА сессия, либо место,
 * которое ведёт сам этот мост: каталог не отличает возвращения от первого
 * появления, и сессия, никогда не стоявшая, унаследовала бы место ушедшего
 * держателя со всем его рассказом о работе (#6017). Ключ сессия знает, только
 * если держала его сокет (`held` своего моста, маркер своей потери).
 * Место, отпущенное словом держателя (`left`), своим не считается никак —
 * вернуть его может только iskron_stand по имени.
 * `sameDir` — все записи этого харнесса того же каталога, для слова «с кем делишь каталог»;
 * `legacy` — записи прежней сборки без сессии в этом каталоге: по каталогу не берутся,
 * но называются вслух, чтобы их держатель вернул их по имени.
 */
function recordsFor(sel: ResumeSelector): {
  own: HoldRecord[];
  sameDir: string[];
  legacy: HoldRecord[];
  left: string[];
  neighbour: string[];
} {
  const dir = standingsDirOf(CFG.authDir);
  if (!existsSync(dir)) return { own: [], sameDir: [], legacy: [], left: [], neighbour: [] };
  const mine = harnessName();
  const led = ledKey();
  const byKey: HoldRecord[] = [];
  const byCwd: HoldRecord[] = [];
  const sameDir: string[] = [];
  const legacy: HoldRecord[] = [];
  const left: string[] = [];
  const neighbour: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".hold"))) {
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as HoldRecord;
      if (!rec || rec.client !== mine) continue; // чужой харнесс — не наше место
      const key = keyOf(rec.realm, rec.karta, rec.name);
      const keyed = !!sel.key && key === sel.key;
      const inDir = oneDir(rec.cwd, sel.cwd); // /tmp и /private/tmp — один каталог (#5048)
      // Стоявшая этой сессией — её и вне каталога: сессию переносят между папками (#6550 п.3).
      const stoodBy = !!sel.session && rec.session === sel.session;
      if (!keyed && !inDir && !stoodBy) continue;
      // Чтение по ключу — то же, что у stand: просроченная запись стирается и не читается.
      const fresh = readHoldRecord(key);
      if (!fresh) continue;
      if (inDir) sameDir.push(key);
      if (fresh.left) {
        left.push(key);
        continue;
      }
      const stoodHere = key === led || (!!sel.session && fresh.session === sel.session);
      // По ключу — тоже не место соседа: на записи стояла другая названная сессия (#6706).
      const theirs = !!sel.session && !!fresh.session && fresh.session !== sel.session;
      if (keyed && theirs) neighbour.push(key);
      else if (keyed) byKey.push(fresh);
      else if (stoodHere) byCwd.push(fresh);
      else if (!fresh.session) legacy.push(fresh);
    } catch {
      /* чужой или битый файл — не наш */
    }
  }
  return {
    own: [...byKey, ...byCwd.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))],
    sameDir,
    legacy,
    left,
    neighbour,
  };
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
 * «держу»; запарковано — обратно на место; чужое или ведём другое — не трогаем.
 */
export async function resumeBy(sel: ResumeSelector, register = true): Promise<ResumeOutcome> {
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
    if (await localSocketAlive(localSocketPathOf(key))) {
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
      const r = await callTool(tool("channel"), {
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
  const url = envOf(envName("CHANNEL_SOCKET"))?.trim();
  if (url) holdStanding(url, envOf(envName("CHANNEL_STATUS"))?.trim() || null);
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

export const isResumeCall = (msg: JsonRpcMessage): boolean => msg?.method === method("resume");
export const isCheckCall = (msg: JsonRpcMessage): boolean => msg?.method === method("check");

/** `iskron/resume {key?, cwd?, session?}` — запрос плагина: вернуть своё место с диска. */
export async function runResume(msg: JsonRpcMessage): Promise<JsonRpcMessage> {
  const sel = selectorFrom(msg);
  if (!sel.key && !sel.cwd) return reply(msg, { resumed: false, word: resumeWords.noKeyNoCwd() });
  const r = await resumeBy(sel);
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
  const board = await callTool(tool("channel"), { action: "list", realm: s.realm });
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
        params: { level: "warning", logger: LOGGERS.channel, data: { kind: "lost", text } },
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
