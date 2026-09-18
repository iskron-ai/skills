// Возврат места с диска (граф nks-dev: #5061, #5140): мост, поднятый заново —
// перезапуск плагина, вытеснение каталога OpenCode, /mcp reconnect — берёт
// место по записи держания, а не ротирует его connect-ом. Две двери:
//   • по имени — iskron_stand (stand.ts) зовёт resumeFromDisk;
//   • по ключу или каталогу сессии — запрос плагина `iskron/resume {key?, cwd?}`:
//     мост находит СВОЮ запись (тот же харнесс, тот же ключ либо тот же
//     каталог), открывает сокет, регистрируется и отвечает, сколько кадров
//     ожидало. Чужого харнесса запись не трогается: Claude Code, вставший в
//     той же копии, не теряет места от плагина OpenCode.
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
  resumeStanding,
} from "./hold.ts";
import { type HoldRecord, keyOf, readHoldRecord } from "./holdrecord.ts";
import { returnToStanding } from "./leave.ts";
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
 * Возвращает слово об исходе или null, когда возвращать нечего.
 */
export async function resumeFromDisk(
  realm: string,
  karta: string | number,
  name: string,
): Promise<{ word: string; status?: string; pending: number } | null> {
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
      log(`standing resumed from disk (${key}), pending ${pending}`);
      standingLog(`resumed-from-disk ${key}: pending ${pending}`);
      return {
        word: `возврат места с диска после перезапуска моста — сокет открыт заново тем же адресом (ожидало кадров — ${pending})`,
        status: rec.status,
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
  /** каталог сессии — откат: записи этого харнесса из этого каталога, свежайшая первой */
  cwd?: string;
}

/**
 * Свои записи держания под выбором — тот же харнесс; по ключу первой, затем по
 * каталогу, свежайшая первой. Ключ — предпочтение, каталог — откат, не «или»:
 * устаревший ключ (мост убит между released и held, подсказка из маркера) не
 * должен глушить живую запись того же каталога.
 */
function recordsFor(sel: ResumeSelector): HoldRecord[] {
  const dir = standingsDirOf(CFG.authDir);
  if (!existsSync(dir)) return [];
  const mine = harnessName();
  const byKey: HoldRecord[] = [];
  const byCwd: HoldRecord[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".hold"))) {
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as HoldRecord;
      if (!rec || rec.client !== mine) continue; // чужой харнесс — не наше место
      const key = keyOf(rec.realm, rec.karta, rec.name);
      const keyed = !!sel.key && key === sel.key;
      if (!keyed && (!sel.cwd || rec.cwd !== sel.cwd)) continue;
      // Чтение по ключу — то же, что у stand: просроченная запись стирается и не читается.
      const fresh = readHoldRecord(key);
      if (fresh) (keyed ? byKey : byCwd).push(fresh);
    } catch {
      /* чужой или битый файл — не наш */
    }
  }
  return [...byKey, ...byCwd.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))];
}

export interface ResumeOutcome {
  resumed: boolean;
  key?: string;
  pending?: number;
  word: string;
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
  const recs = recordsFor(sel);
  if (!recs.length)
    return {
      resumed: false,
      word: `своей записи держания ${sel.key ? `с ключом ${sel.key}` : `для каталога ${sel.cwd ?? "?"}`} нет`,
    };
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
      });
      lines.push(r.isError ? `register отказал — ${short(r.text)}` : "register");
    }
    if (back.status) {
      const st = await publishStatus(back.status);
      lines.push(
        st.ok
          ? `занятость возвращена: ${back.status}`
          : `занятость не возвращена: ${short(st.body)}`,
      );
    }
    return { resumed: true, key, pending: back.pending, word: lines.join("; ") };
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
});

export const isResumeCall = (msg: JsonRpcMessage): boolean => msg?.method === "iskron/resume";
export const isCheckCall = (msg: JsonRpcMessage): boolean => msg?.method === "iskron/check";

/** `iskron/resume {key?, cwd?}` — запрос плагина: вернуть своё место с диска. */
export async function runResume(msg: JsonRpcMessage): Promise<JsonRpcMessage> {
  const sel = selectorOf(msg);
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
  const sel = selectorOf(msg);
  const s = state.standing;
  const key = s ? keyOf(s.realm, s.karta, s.name ?? "") : null;
  if (!s || !key || !holdsKey(key)) {
    if (s && key && isParked(s.realm, s.karta, s.name ?? "")) {
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
