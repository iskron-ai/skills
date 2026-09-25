// Возврат места с диска (граф nks-dev: #5061, #5140): мост, поднятый заново —
// перезапуск плагина, вытеснение каталога OpenCode, /mcp reconnect — берёт
// место по записи держания, а не ротирует его connect-ом. Две двери:
//   • по имени — iskron_stand (stand.ts) зовёт resumeFromDisk;
//   • по ключу или каталогу сессии — запрос плагина `iskron/resume {key?, cwd?, session?}`:
//     мост находит СВОЮ запись (тот же харнесс; тот же ключ — либо тот же
//     каталог И та же сессия, что на месте стояла), открывает сокет,
//     регистрируется и отвечает, сколько кадров ожидало. Чужого харнесса запись
//     не трогается: Claude Code, вставший в той же копии, не теряет места от
//     плагина OpenCode. Сессия, не стоявшая на месте, по одному каталогу его не
//     получает (#6017), а строка занятости прежнего держателя не публикуется
//     заново: это его слово о его работе, и свежая отметка выдала бы её за текущую.
// `iskron/check {key?, cwd?}` — сторож плагина: держим — доска; не слушает →
// сокет переоткрывается; запарковано → возврат на место; не ведём — возврат.
// Мост, ведущий другое место (держит или запарковал), чужой записью не
// занимается: holdStanding иного ключа убил бы ведомое.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { standingsDirOf } from "../shared/standings.ts";
import { listens, nameOf, parseBoard, undelivered } from "./board.ts";
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
import {
  type HoldRecord,
  keyOf,
  noteHarnessSession,
  readHoldRecord,
  sessionOfBridge,
} from "./holdrecord.ts";
import { returnToStanding } from "./leave.ts";
import { placeFields } from "./placefields.ts";
import { publishStatus } from "./status.ts";
import { standingLog } from "./store.ts";
import { emit, log } from "./streams.ts";
import { localSocketAlive } from "./sweep.ts";
import { state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

/** Слушающим доска читает прежний мост этого каталога, а он мёртв: запись держания цела, локальный сокет не отвечает. */
export async function deadPredecessor(
  realm: string,
  karta: string | number,
  name: string,
): Promise<boolean> {
  const key = keyOf(realm, karta, name);
  if (!readHoldRecord(key)) return false;
  return !(await localSocketAlive(localSocketPathOf(key)));
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
        busy = st.ok
          ? `; занятость возвращена: ${rec.status}`
          : `; занятость не возвращена: ${short(st.body)}`;
      } else if (rec.status) {
        rememberStatus(""); // строка прежнего держателя — не наша: в записи её больше нет
        busy = "; прежняя строка занятости не возвращена — скажи свою";
      }
      log(`standing resumed from disk (${key}), pending ${pending}`);
      standingLog(`resumed-from-disk ${key}: pending ${pending}`);
      return {
        word: `возврат места с диска после перезапуска моста — сокет открыт заново тем же адресом (ожидало кадров — ${pending})${busy}`,
        pending,
      };
    }
  } finally {
    noteResuming(-1);
  }
  log(`hold record for ${key} is stale — dropped, the place is taken anew`);
  releaseStanding("возврат с диска не удался", true);
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
 * `legacy` — имена записей прежней сборки без сессии в этом каталоге: по каталогу не берутся,
 * но называются вслух, чтобы их держатель вернул их по имени.
 */
function recordsFor(sel: ResumeSelector): {
  own: HoldRecord[];
  sameDir: string[];
  legacy: string[];
  left: string[];
} {
  const dir = standingsDirOf(CFG.authDir);
  if (!existsSync(dir)) return { own: [], sameDir: [], legacy: [], left: [] };
  const mine = harnessName();
  const led = ledKey();
  const byKey: HoldRecord[] = [];
  const byCwd: HoldRecord[] = [];
  const sameDir: string[] = [];
  const legacy: string[] = [];
  const left: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".hold"))) {
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as HoldRecord;
      if (!rec || rec.client !== mine) continue; // чужой харнесс — не наше место
      const key = keyOf(rec.realm, rec.karta, rec.name);
      const keyed = !!sel.key && key === sel.key;
      const inDir = !!sel.cwd && rec.cwd === sel.cwd;
      if (!keyed && !inDir) continue;
      // Чтение по ключу — то же, что у stand: просроченная запись стирается и не читается.
      const fresh = readHoldRecord(key);
      if (!fresh) continue;
      if (inDir) sameDir.push(key);
      if (fresh.left) {
        left.push(key);
        continue;
      }
      const stoodHere = key === led || (!!sel.session && fresh.session === sel.session);
      if (keyed) byKey.push(fresh);
      else if (stoodHere) byCwd.push(fresh);
      else if (!fresh.session) legacy.push(fresh.name);
    } catch {
      /* чужой или битый файл — не наш */
    }
  }
  return {
    own: [...byKey, ...byCwd.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))],
    sameDir,
    legacy,
    left,
  };
}

/** Слово о записях прежней сборки без сессии: по каталогу не возвращаются, возвращаются по имени. */
export const legacyWord = (names: string[]): string =>
  names
    .map((n) => `есть место прежней сборки без сессии: ${n} — вернуть: iskron_stand(name="${n}")`)
    .join("; ");

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
}

/** Обратно на запаркованное место (leave, переоткрытие): сокет заново, hello — доказательство. */
async function backToParked(key: string, how: string): Promise<ResumeOutcome> {
  if (!returnToStanding(how)) return { resumed: false, key, word: "возврат на место не удался" };
  const hello = await awaitHello(4000);
  return {
    resumed: true,
    key,
    pending: Number(hello?.pending) || 0,
    word: hello
      ? `возврат на место, с которого мост уходил (ожидало кадров — ${Number(hello.pending) || 0})`
      : "возврат на место, с которого мост уходил; hello за 4 с не пришёл",
  };
}

/**
 * Возврат места по ключу или каталогу сессии: своя запись → сокет заново тем же
 * адресом, register (атрибуция записей), занятость обратно. Уже держим —
 * «держу»; запарковано — обратно на место; чужое или ведём другое — не трогаем.
 */
export async function resumeBy(sel: ResumeSelector, register = true): Promise<ResumeOutcome> {
  const { own: recs, sameDir, legacy, left } = recordsFor(sel);
  if (!recs.length) {
    const said = [
      `своей записи держания ${sel.key ? `с ключом ${sel.key}` : `для каталога ${sel.cwd ?? "?"}`} нет`,
    ];
    const foreign = sameDir.filter((k) => !left.includes(k));
    if (foreign.length)
      said.push(
        `в каталоге лежат записи мест, на которых эта сессия не стояла (${foreign.join(", ")}); по одному каталогу они не берутся, место займёт iskron_stand`,
      );
    if (left.length)
      said.push(
        `место отпущено словом держателя (leave): ${left.join(", ")} — само не вернётся, вернуть: iskron_stand тем же именем`,
      );
    if (legacy.length) said.push(legacyWord(legacy));
    return {
      resumed: false,
      word: said.join(" — "),
      ...(legacy.length ? { legacy } : {}),
    };
  }
  const led = ledKey();
  const skipped: string[] = [];
  for (const rec of recs) {
    const key = keyOf(rec.realm, rec.karta, rec.name);
    if (holdsKey(key)) return { resumed: true, key, pending: 0, word: "мост уже держит это место" };
    if (isParked(rec.realm, rec.karta, rec.name)) return backToParked(key, "возврат по записи");
    if (led && led !== key) {
      skipped.push(`${key}: мост ведёт другое место ${led}`);
      continue;
    }
    if (await localSocketAlive(localSocketPathOf(key))) {
      skipped.push(`${key}: держит живой мост`);
      continue;
    }
    const back = await resumeFromDisk(rec.realm, rec.karta, rec.name);
    if (!back) {
      skipped.push(`${key}: запись протухла — место займёт iskron_stand`);
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
      lines.push(r.isError ? `register отказал — ${short(r.text)}` : "register");
    }
    // Записи, которые цикл выше признал протухшими, уже стёрты — их не называть.
    const others = [
      ...new Set([...recs.map((r) => keyOf(r.realm, r.karta, r.name)), ...sameDir]),
    ].filter((k) => k !== key && readHoldRecord(k) !== null);
    if (others.length) lines.push(`в том же каталоге записи и других мест: ${others.join(", ")}`);
    // Взятое не своё — отпустить, не кончая канала: revoke места, основавшего канал, платформа отвергает.
    lines.push('место не твоё — iskron_channel(action="leave") отпустит его, канал цел');
    return { resumed: true, key, pending: back.pending, word: lines.join("; "), others };
  }
  return { resumed: false, word: `возвращать нечего — ${skipped.join("; ")}` };
}

/** Старт моста: сокет из окружения без connect — отладочный путь. */
export function holdFromEnv(): void {
  const url = process.env.ISKRON_CHANNEL_SOCKET?.trim();
  if (url) holdStanding(url, process.env.ISKRON_CHANNEL_STATUS?.trim() || null);
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
  return sel;
}

export const isResumeCall = (msg: JsonRpcMessage): boolean => msg?.method === "iskron/resume";
export const isCheckCall = (msg: JsonRpcMessage): boolean => msg?.method === "iskron/check";

/** `iskron/resume {key?, cwd?, session?}` — запрос плагина: вернуть своё место с диска. */
export async function runResume(msg: JsonRpcMessage): Promise<JsonRpcMessage> {
  const sel = selectorFrom(msg);
  if (!sel.key && !sel.cwd)
    return reply(msg, { resumed: false, word: "ни key, ни cwd не передан" });
  return reply(msg, await resumeBy(sel));
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
          word: `место ${key} отпущено словом держателя (leave) — сторож его не поднимает; вернуть: iskron_stand тем же именем`,
        });
      const r = await backToParked(key, "сторож слуха");
      return reply(msg, { holding: r.resumed, ...r });
    }
    if (!sel.key && !sel.cwd)
      return reply(msg, {
        holding: false,
        resumed: false,
        word: "места нет, ни key, ни cwd не передан",
      });
    const r = await resumeBy(sel);
    return reply(msg, { holding: r.resumed, ...r });
  }
  const board = await callTool("iskron_channel", { action: "list", realm: s.realm });
  if (board.isError)
    return reply(msg, { holding: true, key, word: `доска не прочиталась — ${short(board.text)}` });
  const mine = parseBoard(board.text).find(
    (e) => e.karta === String(s.karta) && nameOf(e.address) === (s.name ?? ""),
  );
  if (!mine) return reply(msg, { holding: true, key, word: "своего места на доске нет" });
  const pending = undelivered(mine);
  const listening = listens(mine);
  if (listening) {
    deafReopens = 0; // слух вернулся — счёт переоткрытий с начала
    return reply(msg, { holding: true, key, listening, pending, word: "слушаю" });
  }
  // Сокет у моста жив, а доска нас не слышит: переоткрыть тем же адресом. Счётчик
  // «не доставлено N» — только слово в ответе, решает признак слуха. Тормоз:
  // два переоткрытия подряд не вернули слух — третьего нет, слово вслух вместо
  // него (иначе каждый такт сторожа рвал бы живой сокет бесконечно).
  if (deafReopens >= REOPEN_LIMIT) {
    const text =
      `Искрон: доска читает место ${key} не слушающим и после ${REOPEN_LIMIT} переоткрытий сокета — ` +
      "больше не рву; проверь доску и сервер, вернуть слух — iskron_stand с take=true.";
    if (!deafSaid) {
      deafSaid = true;
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
  deafReopens++;
  standingLog(`reopen ${key}: board reads deaf${pending ? ` with ${pending} pending` : ""}`);
  parkStanding("доска не читает слушающим");
  resumeStanding();
  const hello = await awaitHello(4000);
  return reply(msg, {
    holding: true,
    key,
    listening,
    pending,
    reopened: !!hello,
    word: hello
      ? `сокет переоткрыт: ожидало кадров — ${Number(hello.pending) || 0}`
      : "сокет переоткрыт, hello за 4 с не пришёл",
  });
}

/** Переоткрытий подряд при доске, читающей место глухим; предел — REOPEN_LIMIT, дальше слово вслух. */
let deafReopens = 0;
let deafSaid = false;
const REOPEN_LIMIT = 2;
