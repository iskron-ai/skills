// Занятость стояния — слово держателя сокета, а держит его мост (решение
// владельца, граф nks-dev: #4284 отвергнут). Основной ход — iskron_stand(status)
// на месте, которое мост уже держит (#6509): мост, приносящий агенту кадры,
// и ставит его занятость; action="status" у iskron_channel — прежний ход, живёт
// ради совместимости. Оба исполняются здесь, на сервер не уходят. POST на
// статусный адрес из ответа connect; ответ поверхности доносится целиком.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { L } from "../shared/lang.ts";
import { socketPathOf, standingsDirOf } from "../shared/standings.ts";
import { nameOf } from "./board.ts";
import { resolveAgainstLed } from "./call.ts";
import { CFG } from "./config.ts";
import {
  heldPlaces,
  holdsStanding,
  isParked,
  noteStandCwd,
  rememberStatus,
  statusAddress,
} from "./hold.ts";
import { type HoldRecord, keyOf } from "./holdrecord.ts";
import { unheardListenBlock } from "./listen.ts";
import { normKarta, normName } from "./names.ts";
import { extraIn } from "./places.ts";
import { sameRealm } from "./realms.ts";
import { localSocketAlive } from "./sweep.ts";
import { type Standing, state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

const isDirectory = (p: string): boolean => {
  try {
    return isAbsolute(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const replyTo =
  (msg: JsonRpcMessage) =>
  (body: string, isError = false): JsonRpcMessage => ({
    jsonrpc: "2.0",
    id: msg.id,
    result: { ...(isError ? { isError: true } : {}), content: [{ type: "text", text: body }] },
  });

/** Публикация строки занятости места этого графа и слово о ней — общее для обоих ходов. */
async function statusWord(text: string, realm: string): Promise<[string, boolean]> {
  const st = await publishStatus(text, realm);
  if (!st.ok && !statusAddress()) return [await notHeldHere(realm), true];
  if (st.code === 404) return [`${st.body} ${TURNED_GUIDANCE()}`, true];
  if (st.ok) return [`занятость ${statusAddress(realm)?.key}: ${text || "(снята)"}`, false];
  return [st.body, true];
}

/** action="status" — занятость ЭТОГО стояния. Возвращает null для всякого другого вызова. */
export function localStatus(msg: JsonRpcMessage): Promise<JsonRpcMessage> | null {
  if (msg?.method !== "tools/call" || msg?.params?.name !== "iskron_channel") return null;
  const a = msg.params?.arguments;
  if (a?.action !== "status") return null;
  const text = typeof a.text === "string" ? a.text : "";
  const reply = replyTo(msg);
  // Занятость — места графа из вызова (#5838); без графа — основного.
  const realm = typeof a.realm === "string" ? a.realm : "";
  return (async () => {
    await resolveAgainstLed(realm); // граф вызова — в той же форме, что граф места
    return reply(...(await statusWord(text, realm)));
  })();
}

/**
 * Аргументы iskron_stand, с которыми вызов со status — только занятость; всякий
 * другой ведёт полный путь. satellite_of подставляет сам плагин OpenCode каждому
 * вызову дочерней сессии — он сверяется с держимым местом-спутником. model несёт
 * старт двери (и повторный старт после возврата): он сверяет место — register,
 * хук инбокса, hello — и потому идёт полным путём.
 */
const STATUS_ONLY_ARGS = new Set(["realm", "karta", "name", "cwd", "status", "satellite_of"]);

/**
 * iskron_stand со status на месте, которое этот мост уже держит живым сокетом
 * (решение владельца, #6509): только строка занятости — без доски, connect,
 * register, хука и стука; пустая строка снимает. Роль и имя — те же, что у
 * места, или опущены. Null — вызов не такой, его ведёт полный путь stand.ts.
 */
export async function standStatusOnly(msg: JsonRpcMessage): Promise<JsonRpcMessage | null> {
  const a = msg.params?.arguments ?? {};
  if (typeof a.status !== "string") return null;
  const unset = (v: unknown): boolean => v == null || v === false || v === "";
  if (Object.keys(a).some((k) => !STATUS_ONLY_ARGS.has(k) && !unset(a[k]))) return null;
  const realm = typeof a.realm === "string" ? a.realm.trim() : "";
  if (!realm) return null;
  await resolveAgainstLed(realm); // граф вызова — в той же форме, что граф места
  const held = ledIn(realm);
  if (!held) return null;
  if (!unset(a.karta) && normKarta(a.karta) !== String(held.karta)) return null;
  const asked = normName(a.name);
  if (asked && asked !== (held.name ?? "")) return null;
  // Спутник — <имя позвавшего>.sub-N; длинную базу мост укорачивает, потому сличение — префиксом.
  const of = normName(a.satellite_of);
  const base = /^(.+)\.sub-[1-9]\d*$/.exec(held.name ?? "")?.[1];
  if (of && !(base && nameOf(of).startsWith(base))) return null;
  if (!holdsStanding(held.realm, held.karta, held.name ?? "")) return null;
  // Каталог — локальная память места, как у полного пути: запись держания несёт его для возврата (resume.ts).
  const cwd = typeof a.cwd === "string" ? a.cwd.trim() : "";
  if (cwd) {
    if (cwd !== process.cwd() && !isDirectory(cwd)) return null; // кривой каталог отказывает полный путь, вслух
    noteStandCwd(cwd);
  }
  const [body, isError] = await statusWord(a.status.trim(), realm);
  // Место держит мост, а сторож к нему не прицеплен — команда слушания тут же.
  const listen = isError ? null : unheardListenBlock(realm);
  return replyTo(msg)(listen ? `${body}\n${listen}` : body, isError);
}

/** Место, которое мост ведёт в этом графе (основное либо рядом), — держит ли он сокет, не судит. */
function ledIn(realm: string): Standing | undefined {
  const prim = state.standing;
  return prim && (prim.realm === realm || sameRealm(prim.realm, realm))
    ? prim
    : extraIn(realm)?.standing;
}

/**
 * Почему iskron_stand(realm, status) без karta не стал занятостью — для слова
 * отказа (standwords.ts): места в графе нет; ушёл с него словом (leave); место
 * ведётся, а сокет у другого моста; место слышно здесь, но вызов несёт то, что
 * ведёт полный путь занятия.
 */
export type StatusMiss = "none" | "parked" | "elsewhere" | "full";
export async function statusMiss(realm: string): Promise<StatusMiss> {
  await resolveAgainstLed(realm);
  const held = ledIn(realm);
  if (!held) return "none";
  const [r, k, n] = [held.realm, held.karta, held.name ?? ""];
  if (isParked(r, k, n)) return "parked";
  return holdsStanding(r, k, n) ? "full" : "elsewhere";
}

/** Исход POST занятости; code — HTTP-код отказа поверхности, когда он был. */
export interface StatusOutcome {
  ok: boolean;
  body: string;
  code?: number;
}

let lastPublished = "";
/** Последняя строка занятости, которую доска приняла от этого моста; пустая — снята. */
export const publishedStatus = (): string => lastPublished;

/**
 * POST строки занятости на статусный адрес канала, который держит мост. Строка
 * держится у МЕСТА: со standing_id она ложится на одно место канала, без него —
 * на все живые (#5838). realm — место этого графа; `everyPlace` — все места разом (уход).
 */
export async function publishStatus(
  text: string,
  realm?: string,
  everyPlace = false,
): Promise<StatusOutcome> {
  const addr = statusAddress(realm);
  if (!addr) {
    return {
      ok: false,
      body: "Отказано (мост): этот мост места не держит, статусного адреса у него нет.",
    };
  }
  // Мест на канале несколько, а id этого не известен — строка легла бы на все: отказ вслух.
  // Место одно — строка без id ложится на него же, как прежде.
  if (!everyPlace && !addr.standingId && heldPlaces().length > 1)
    return {
      ok: false,
      body: `Отказано (мост): id места ${addr.key} у моста ещё не известен (hello его не назвал) — без него строка легла бы на все места канала; повтори iskron_stand этого графа.`,
    };
  const st = await publishStatusTo(addr.url, text, 5000, everyPlace ? null : addr.standingId);
  if (st.ok) {
    if (addr.key === statusAddress()?.key) lastPublished = text;
    rememberStatus(text, realm);
  }
  return st;
}

/**
 * Путь передачи слуха целиком: читающий отказ взвешивает «забрать слух» против
 * «слышать» и, не зная о возврате, выбирает молчащую строку (граф nks-dev: #5395).
 */
export const TAKE_PATH = (): string =>
  L(
    "iskron_stand с take=true — только по слову человека — переносит слух и статусный адрес сюда ОДИН раз: адрес остаётся у ЭТОГО экземпляра моста, " +
      "и поднятый следом сторож его не уносит — по устройству: сторож есть локальный клиент сокета, своего connect он не делает (замер: два вызова занятости подряд при живом стороже, сборка 6.10.1; путь take наблюдала сторона nks-mcp на своей). Прежний держатель получит закрытие 4000 " +
      "(вытесненному отбивать место назад тем же ходом не нужно — ему место рядом, имя.N); входной адрес и очередь места connect не трогает, ждавшее придёт в hello " +
      '(справка iskron_channel action="?", connect); после переноса перевзведи сторожа командой из ответа',
    "iskron_stand with take=true — only on the human's word — moves the hearing and the status address here ONCE: the address stays with THIS bridge instance, " +
      "and a watchdog raised after it does not carry it off — by design: the watchdog is a local client of the socket and makes no connect of its own. The former holder gets close 4000 " +
      "(the evicted one need not take the seat back the same way — it gets a seat beside, name.N); connect does not touch the seat's incoming address and queue, what waited comes in hello " +
      '(help: iskron_channel action="?", connect); after the move re-arm the watchdog with the command from the answer',
  );

/** Случай двух записей iskron в одной сессии: место держит мост той же сессии, передача не нужна. */
const TWO_ENTRIES = (): string =>
  L(
    "Если место — твоё и держит его мост этой же сессии (в ней две записи iskron, плагинная и пользовательская), зови status тем же набором тулов, которым звал iskron_stand: передача не нужна.",
    "If the seat is yours and a bridge of this same session holds it (the session has two iskron entries, the plugin's and the user's), call status with the same tool set you called iskron_stand with: no move is needed.",
  );

/** Отказ 404: адрес повернул чужой connect — чей, мост не знает, и запись держания общая, поэтому список держателей здесь не печатается. */
export const TURNED_GUIDANCE = (): string =>
  `${TWO_ENTRIES()} ${L("Иначе", "Otherwise")} ${TAKE_PATH()}.`;

const slugOf = (realm: string): string => realm.replace(/^@[^/]+\//, "");

/**
 * Места графа realm, которые держат живые мосты этой машины. Жизнь — по
 * отвечающему локальному сокету, не по возрасту записи: долгая вахта без смены
 * занятости жива и тогда, когда её запись старше срока, — и чтение её не стирает.
 */
async function heldElsewhere(realm: string): Promise<HoldRecord[]> {
  const dir = standingsDirOf(CFG.authDir);
  if (!existsSync(dir)) return [];
  const anyRealm = !realm || /^r\d+$/.test(realm); // короткий id с записью не сличить
  const out: HoldRecord[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".hold"))) {
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as HoldRecord;
      if (!rec?.realm || rec.karta == null) continue;
      if (!anyRealm && slugOf(String(rec.realm)) !== slugOf(realm)) continue;
      const key = keyOf(rec.realm, rec.karta, rec.name ?? "");
      if (await localSocketAlive(socketPathOf(CFG.authDir, key))) out.push({ ...rec, key });
    } catch {
      /* битый файл — не держатель */
    }
  }
  return out;
}

/** Отказ моста без стояния: называет живые мосты этой машины на этом графе, если они есть, и путь передачи целиком. */
export async function notHeldHere(realm: string): Promise<string> {
  const head = "Отказано (мост): этот мост места не держит, статусного адреса у него нет.";
  const others = await heldElsewhere(realm);
  if (!others.length)
    return (
      `${head} Назовись одним вызовом iskron_stand(realm, karta, model, status) — занятость можно передать прямо в нём. ` +
      `Если место слушает другой держатель, iskron_stand скажет это; тогда ${TAKE_PATH()}.`
    );
  const list = others
    .map((r) => {
      const where = [r.cwd && `каталог ${r.cwd}`, r.client && `харнесс ${r.client}`].filter(
        Boolean,
      );
      return where.length ? `${r.key} (${where.join(", ")})` : r.key;
    })
    .join("; ");
  return `${head} Места этого графа на этой машине держат живые мосты: ${list}. ${TURNED_GUIDANCE()}`;
}

/** Тот же POST на названный адрес — для выхода, когда стояние уже отпущено, а адрес снят до этого. */
export async function publishStatusTo(
  url: string,
  text: string,
  timeoutMs = 5000,
  standingId: string | null = null,
): Promise<StatusOutcome> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(standingId ? { text, standing_id: standingId } : { text }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return {
      ok: false,
      body: `Отказано (мост): статусный адрес не ответил — ${(e as Error).message}`,
    };
  }
  const body = (await res.text().catch(() => "")).trim();
  if (res.status === 404)
    return {
      ok: false,
      code: 404,
      body: `Отказано (404) поверхностью: ${body || "без тела"} — этот адрес места больше не адресует: его мог повернуть connect другого держателя, а мог держать другой экземпляр моста той же сессии. Чей он теперь, мост отсюда не знает.`,
    };
  if (!res.ok)
    return {
      ok: false,
      code: res.status,
      body: `Отказано (${res.status}) поверхностью: ${body || "без тела"}`,
    };
  return { ok: true, body };
}
