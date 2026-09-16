// Уход с места — ход между отлучкой и снятием (граф nks-dev: #4895).
//
// Отлучка на мосту не прекращала доставку: сокет держит мост, пока жива
// сессия, и место читается с доски «слушает», хотя делатель ушёл — контекст
// забился, сторож не взведён, сессия закрыта. Снятие (revoke) прекращает
// доставку ценой адреса и хуков. Здесь третье: сокет закрыт, занятость снята,
// адрес, очередь и хуки целы; почта копится у платформы и придёт лежалым
// хвостом, когда делатель вернётся — сторожем к тому же сокету или iskron_stand.
//
// Три повода уйти, все — движения моста:
//   • слово делателя: iskron_channel(action="leave") — исполняет мост;
//   • глухота: харнес слышит кадры только через локального клиента (сторож под
//     Monitor в Claude Code, watchdog-codex в Codex), а его нет дольше порога —
//     место читалось бы слушающим при делателе, которого не разбудить;
//     pi и OpenCode кадр получают уведомлением и глухими не бывают;
//   • конец сессии: занятость снимается перед выходом (main.ts).
import { NOTIFIED_CLIENTS } from "../shared/clients.ts";
import {
  holdsStanding,
  listenerIdleSince,
  onListenerAttached,
  parkStanding,
  resumeStanding,
} from "./hold.ts";
import { publishStatus } from "./status.ts";
import { log } from "./streams.ts";
import { state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

/** Порог глухоты; переменная — шов для проб, не ручка человека. */
const DEAF_MS = Number(process.env.ISKRON_BRIDGE_DEAF_MS) || 15 * 60_000;
const TICK_MS = Math.min(60_000, Math.max(200, Math.floor(DEAF_MS / 5)));

/** Кадры этому харнесу доходят только через локального клиента моста. */
function deafWithoutListener(): boolean {
  const info = (state.initParams as { clientInfo?: { name?: unknown } } | null)?.clientInfo;
  return !(typeof info?.name === "string" && NOTIFIED_CLIENTS.has(info.name));
}

/** Уйти с места: занятость снята, сокет закрыт, место цело. Возвращает слово о сделанном. */
export async function leaveStanding(reason: string): Promise<string> {
  const parked = parkStanding(reason);
  if (!parked) return "мост места не держит — уходить неоткуда";
  const st = await publishStatus("");
  const line = st.ok ? "занятость снята" : `занятость не снята (${st.body})`;
  log(`left the standing: ${reason}; ${line}`);
  return `ушёл с места ${parked}: сокет закрыт, ${line}; адрес, очередь и хуки целы — почта копится и придёт при возвращении (сторож или iskron_stand)`;
}

/**
 * Сторож глухоты: раз в такт смотрит, слушает ли кто мост; никого дольше
 * порога при харнесе, которому кадры доходят только сторожем, — уходит с места.
 * Возвращение — прицепившийся сторож: место открывается заново тем же адресом.
 */
export function startDeafnessWatch(): void {
  onListenerAttached(() => {
    if (resumeStanding()) log("a listener attached — the standing is held again");
  });
  setInterval(() => {
    const since = listenerIdleSince();
    if (since == null || !deafWithoutListener()) return;
    if (Date.now() - since < DEAF_MS) return;
    const s = state.standing;
    if (!s || !holdsStanding(s.realm, s.karta, s.name ?? "")) return;
    void leaveStanding(`никто не слушает ${Math.round(DEAF_MS / 60_000)} мин`);
  }, TICK_MS).unref();
}

/** action="leave" у iskron_channel — слово делателя, исполняет мост. */
export function localLeave(msg: JsonRpcMessage): Promise<JsonRpcMessage> | null {
  if (msg?.method !== "tools/call" || msg?.params?.name !== "iskron_channel") return null;
  if (msg.params?.arguments?.action !== "leave") return null;
  return leaveStanding("по слову делателя").then((text) => ({
    jsonrpc: "2.0",
    id: msg.id,
    result: { content: [{ type: "text", text }] },
  }));
}
