// Возврат места с диска (граф nks-dev: #5061, #5140): мост, поднятый заново —
// перезапуск плагина, вытеснение каталога OpenCode, /mcp reconnect — берёт
// место по записи держания, а не ротирует его connect-ом. Две двери:
//   • по имени — iskron_stand (stand.ts) зовёт resumeFromDisk;
//   • по каталогу сессии — запрос плагина `iskron/resume {cwd}` или окружение
//     ISKRON_BRIDGE_RESUME_CWD на старте: мост сам находит запись с этим cwd,
//     открывает сокет, регистрируется и отвечает, сколько кадров ожидало.
// `iskron/check {cwd}` — сторож плагина: держим — доска не читает нас
// слушающими при ожидающих кадрах → сокет переоткрывается; не держим — возврат.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { standingsDirOf } from "../shared/standings.ts";
import { listens, parseBoard, undelivered } from "./board.ts";
import { callTool, short } from "./call.ts";
import { CFG } from "./config.ts";
import {
  awaitHello,
  holdsKey,
  holdStanding,
  localSocketPathOf,
  noteResuming,
  noteStandCwd,
  parkStanding,
  releaseStanding,
  resumeStanding,
} from "./hold.ts";
import { type HoldRecord, keyOf, readHoldRecord } from "./holdrecord.ts";
import { publishStatus } from "./status.ts";
import { standingLog } from "./store.ts";
import { log } from "./streams.ts";
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
 * только когда его локальный сокет мёртв (живой держатель — не наше место).
 * Слух доказывается свежим hello; мёртвый токен — протухшая запись, стирается
 * тихо, и место занимается заново connect-ом. Возвращает слово об исходе или
 * null, когда возвращать нечего.
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
  if (await localSocketAlive(localSocketPathOf(key))) return null; // держит живой мост — не наше
  state.standing = { realm, karta, name };
  if (rec.cwd) noteStandCwd(rec.cwd);
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
  state.standing = null;
  return null;
}

/** Записи держания этого каталога сессии, свежие, свежайшая первой. */
function recordsFor(cwd: string): HoldRecord[] {
  const dir = standingsDirOf(CFG.authDir);
  if (!existsSync(dir)) return [];
  const out: HoldRecord[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".hold"))) {
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as HoldRecord;
      if (rec?.cwd !== cwd) continue;
      // Чтение по ключу — то же, что у stand: просроченная запись стирается и не читается.
      const fresh = readHoldRecord(keyOf(rec.realm, rec.karta, rec.name));
      if (fresh) out.push(fresh);
    } catch {
      /* чужой или битый файл — не наш */
    }
  }
  return out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

export interface ResumeOutcome {
  resumed: boolean;
  key?: string;
  pending?: number;
  word: string;
}

/**
 * Возврат места по каталогу сессии: запись с этим cwd → сокет заново тем же
 * адресом, register (атрибуция записей), занятость обратно. Нет записи — слово
 * об этом, ничего не занято.
 */
export async function resumeByCwd(cwd: string, register = true): Promise<ResumeOutcome> {
  if (
    state.standing &&
    holdsKey(keyOf(state.standing.realm, state.standing.karta, state.standing.name ?? ""))
  )
    return { resumed: false, word: "мост уже держит место — возвращать нечего" };
  const recs = recordsFor(cwd);
  if (!recs.length) return { resumed: false, word: `записи держания для каталога ${cwd} нет` };
  const rec = recs[0];
  const key = keyOf(rec.realm, rec.karta, rec.name);
  const back = await resumeFromDisk(rec.realm, rec.karta, rec.name);
  if (!back)
    return { resumed: false, key, word: `запись ${key} протухла — место займёт iskron_stand` };
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
      st.ok ? `занятость возвращена: ${back.status}` : `занятость не возвращена: ${short(st.body)}`,
    );
  }
  return { resumed: true, key, pending: back.pending, word: lines.join("; ") };
}

/** Старт моста: сокет из окружения без connect (отладка) либо возврат места по каталогу сессии. */
export function holdFromEnv(): void {
  const url = process.env.ISKRON_CHANNEL_SOCKET?.trim();
  if (url) {
    holdStanding(url, process.env.ISKRON_CHANNEL_STATUS?.trim() || null);
    return;
  }
  const cwd = process.env.ISKRON_BRIDGE_RESUME_CWD?.trim();
  if (!cwd) return;
  // Сессии к серверу ещё нет: только сокет; register доделает ensureStanding
  // перед первым вызовом — стояние после возврата помнится, а сессии за ним нет.
  void resumeByCwd(cwd, false).then((r) => log(`resume by cwd at start: ${r.word}`));
}

const reply = (msg: JsonRpcMessage, result: unknown): JsonRpcMessage => ({
  jsonrpc: "2.0",
  id: msg.id,
  result,
});

export const isResumeCall = (msg: JsonRpcMessage): boolean => msg?.method === "iskron/resume";
export const isCheckCall = (msg: JsonRpcMessage): boolean => msg?.method === "iskron/check";

/** `iskron/resume {cwd}` — запрос плагина: вернуть место этого каталога с диска. */
export async function runResume(msg: JsonRpcMessage): Promise<JsonRpcMessage> {
  const cwd = typeof msg.params?.cwd === "string" ? msg.params.cwd.trim() : "";
  if (!cwd) return reply(msg, { resumed: false, word: "cwd не передан" });
  return reply(msg, await resumeByCwd(cwd));
}

/**
 * `iskron/check {cwd}` — сторож плагина раз в N минут: держим место — доска;
 * не слушает при ожидающих кадрах — сокет переоткрывается (hello с pending
 * откроет пачку побудки); не держим — возврат по каталогу.
 */
export async function runCheck(msg: JsonRpcMessage): Promise<JsonRpcMessage> {
  const cwd = typeof msg.params?.cwd === "string" ? msg.params.cwd.trim() : "";
  const s = state.standing;
  const held = !!s && holdsKey(keyOf(s.realm, s.karta, s.name ?? ""));
  if (!held) {
    if (!cwd)
      return reply(msg, { holding: false, resumed: false, word: "места нет, cwd не передан" });
    const r = await resumeByCwd(cwd);
    return reply(msg, { holding: r.resumed, ...r });
  }
  const board = await callTool("iskron_channel", { action: "list", realm: s.realm });
  if (board.isError)
    return reply(msg, { holding: true, word: `доска не прочиталась — ${short(board.text)}` });
  const mine = parseBoard(board.text).find(
    (e) => e.karta === String(s.karta) && e.address.endsWith(`:${s.name ?? ""}`),
  );
  if (!mine) return reply(msg, { holding: true, word: "своего места на доске нет" });
  const pending = undelivered(mine);
  const listening = listens(mine);
  if (listening || !pending)
    return reply(msg, { holding: true, listening, pending, word: "слушаю" });
  // Сокет у моста жив, а доска нас не слышит и держит кадры: переоткрыть тем же адресом.
  standingLog(
    `reopen ${keyOf(s.realm, s.karta, s.name ?? "")}: board reads deaf with ${pending} pending`,
  );
  parkStanding("доска не читает слушающим при ожидающих кадрах");
  resumeStanding();
  const hello = await awaitHello(4000);
  return reply(msg, {
    holding: true,
    listening,
    pending,
    reopened: !!hello,
    word: hello
      ? `сокет переоткрыт: ожидало кадров — ${Number(hello.pending) || 0}`
      : "сокет переоткрыт, hello за 4 с не пришёл",
  });
}
