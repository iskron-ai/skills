// Занятость стояния — слово держателя сокета, а держит его мост (решение
// владельца, граф nks-dev: #4284 отвергнут): action="status" у iskron_channel
// исполняется здесь, на сервер не уходит. POST на статусный адрес из ответа
// connect; ответ поверхности — успех или ProblemDetail — доносится целиком.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { socketPathOf, standingsDirOf } from "../shared/standings.ts";
import { CFG } from "./config.ts";
import { rememberStatus, statusAddress } from "./hold.ts";
import { type HoldRecord, keyOf, readHoldRecord } from "./holdrecord.ts";
import { localSocketAlive } from "./sweep.ts";
import { type JsonRpcMessage } from "./types.ts";

/** action="status" — занятость ЭТОГО стояния. Возвращает null для всякого другого вызова. */
export function localStatus(msg: JsonRpcMessage): Promise<JsonRpcMessage> | null {
  if (msg?.method !== "tools/call" || msg?.params?.name !== "iskron_channel") return null;
  const a = msg.params?.arguments;
  if (a?.action !== "status") return null;
  const text = typeof a.text === "string" ? a.text : "";
  const reply = (body: string, isError = false): JsonRpcMessage => ({
    jsonrpc: "2.0",
    id: msg.id,
    result: { ...(isError ? { isError: true } : {}), content: [{ type: "text", text: body }] },
  });
  return (async () => {
    const st = await publishStatus(text);
    if (!st.ok && !statusAddress()) return reply(await notHeldHere(), true);
    if (st.code === 404) return reply(`${st.body} ${await holderGuidance()}`, true);
    if (st.ok) return reply(`занятость ${statusAddress()?.key}: ${text || "(снята)"}`);
    return reply(st.body, true);
  })();
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

/** POST строки занятости на статусный адрес стояния, которое держит мост. */
export async function publishStatus(text: string): Promise<StatusOutcome> {
  const addr = statusAddress();
  if (!addr) {
    return {
      ok: false,
      body: "Отказано (мост): этот мост места не держит, статусного адреса у него нет.",
    };
  }
  const st = await publishStatusTo(addr.url, text);
  if (st.ok) {
    lastPublished = text;
    rememberStatus(text);
  }
  return st;
}

/**
 * Путь передачи слуха целиком: читающий отказ взвешивает «забрать слух» против
 * «слышать» и, не зная о возврате, выбирает молчащую строку (граф nks-dev: #5395).
 */
export const TAKE_PATH =
  "iskron_stand с take=true переносит слух и статусный адрес сюда — ход обратим: прежний держатель получит закрытие 4000, " +
  "вернуть место ему — iskron_stand с take=true из его сессии; кадры, ждущие места, лежат у платформы и передачу переживают (придут в hello); " +
  "после переноса перевзведи сторожа командой из ответа";

/** Места, которые держат другие живые мосты этой машины: свежая запись держания и отвечающий локальный сокет. */
async function heldElsewhere(): Promise<HoldRecord[]> {
  const dir = standingsDirOf(CFG.authDir);
  if (!existsSync(dir)) return [];
  const out: HoldRecord[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".hold"))) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf8")) as HoldRecord;
      const key = keyOf(raw.realm, raw.karta, raw.name);
      if (key === statusAddress()?.key) continue; // своё место — не «другой мост»
      const rec = readHoldRecord(key);
      if (rec && (await localSocketAlive(socketPathOf(CFG.authDir, key))))
        out.push({ ...rec, key });
    } catch {
      /* битый файл — не держатель */
    }
  }
  return out;
}

/** Кто держит место и как быть: живые мосты этой машины, случай двух записей и путь take целиком. */
export async function holderGuidance(): Promise<string> {
  const others = await heldElsewhere();
  if (!others.length)
    return `Если место слушает другой держатель, iskron_stand скажет это; тогда ${TAKE_PATH}.`;
  const list = others
    .map((r) => {
      const where = [r.cwd && `каталог ${r.cwd}`, r.client && `харнесс ${r.client}`].filter(
        Boolean,
      );
      return where.length ? `${r.key} (${where.join(", ")})` : r.key;
    })
    .join("; ");
  return (
    `Места на этой машине держат другие живые мосты: ${list}. ` +
    "Если среди них твоё место — в сессии две записи iskron (плагинная и пользовательская): зови status тем же набором тулов, которым звал iskron_stand, передача не нужна. " +
    `Иначе ${TAKE_PATH}.`
  );
}

/** Отказ моста без стояния: называет живого держателя этой машины, если он есть, и путь передачи целиком. */
export async function notHeldHere(): Promise<string> {
  const head = "Отказано (мост): этот мост места не держит, статусного адреса у него нет.";
  const guide = await holderGuidance();
  if (guide.startsWith("Места")) return `${head} ${guide}`;
  return `${head} Назовись одним вызовом iskron_stand(realm, karta, model, status) — занятость можно передать прямо в нём. ${guide}`;
}

/** Тот же POST на названный адрес — для выхода, когда стояние уже отпущено, а адрес снят до этого. */
export async function publishStatusTo(
  url: string,
  text: string,
  timeoutMs = 5000,
): Promise<StatusOutcome> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
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
      body: `Отказано (404) поверхностью: ${body || "без тела"} — статусный адрес повернули connect-ом другого держателя, занятость теперь его.`,
    };
  if (!res.ok)
    return {
      ok: false,
      code: res.status,
      body: `Отказано (${res.status}) поверхностью: ${body || "без тела"}`,
    };
  return { ok: true, body };
}
