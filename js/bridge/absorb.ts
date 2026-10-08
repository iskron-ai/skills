// Ответ connect/mint и своё снятие — что мост берёт из проксируемых ответов
// канала (граф nks-dev: #4233, #5033). Секрет сокета вырезается, держание
// уходит в hold.ts; своё revoke отпускает место тихо (#5012).
import { tool } from "../delivery/index.ts";
import { statusUrl as deriveStatusUrl } from "../shared/channel.ts";
import { L } from "../shared/lang.ts";
import {
  besideKeyIn,
  holdStanding,
  releaseStanding,
  setClosingOwn,
  setRevokingOwn,
} from "./hold.ts";
import { holdWords } from "./holdwords.ts";
import { listenBlock } from "./listen.ts";
import { dropExtra, extraIn, extraPlaces } from "./places.ts";
import { otherRealm } from "./realms.ts";
import { rememberedPlace, replyText } from "./standing.ts";
import { log } from "./streams.ts";
import { type Standing, state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

const SOCKET_RE =
  /wss:\/\/[^\s"'`<>)\]]+|ws:\/\/(?:127\.0\.0\.1|\[?::1\]?|localhost)(?::\d+)?\/[^\s"'`<>)\]]+/;
const STATUS_RE = /https?:\/\/[^\s"'`<>)\]]+\/channel\/status\/[^\s"'`<>)\]]+/;
const trim = (s: string): string => s.replace(/[.,;:!?»"')\]]+$/, "");

/**
 * Секрет не покидает моста (граф nks-dev: #4233, #5033): адреса сокета и
 * статуса из ответа вырезаются — слушать снаружи нечем, и никакая дверь
 * харнеса не отнимет сокет у самого агента.
 */
const hideAddresses = (text: string): string =>
  text
    .replace(
      new RegExp(SOCKET_RE.source, "g"),
      L(
        "(адрес сокета держит мост — агенту не показывается)",
        "(the bridge holds the socket address — it is not shown to the agent)",
      ),
    )
    .replace(
      new RegExp(STATUS_RE.source, "g"),
      L("(статусный адрес держит мост)", "(the bridge holds the status address)"),
    );

/**
 * Ответ connect/mint прошёл через мост: взять из него сокет и держать, а сам
 * ответ дополнить тем, чего сервер знать не может, — точной командой слушания
 * и путём файла занятости. Возвращает дополненный ответ либо исходный.
 */
export function absorbChannelReply(msg: JsonRpcMessage, reply: JsonRpcMessage): JsonRpcMessage {
  const a = msg?.params?.arguments;
  if (msg?.params?.name !== tool("channel")) return reply;
  if (a?.action !== "connect" && a?.action !== "mint") return reply;
  if (reply?.error || reply?.result?.isError) return reply;
  const text = replyText(reply);
  const socket = SOCKET_RE.exec(text)?.[0];
  if (!socket) return reply;
  const status = STATUS_RE.exec(text)?.[0];
  if (a.realm && a.karta != null) {
    // connect назвал место — ключ, сокет и файл занятости идут под ЭТИМ именем,
    // даже если прежде мост держал другое: ярлык врать не должен.
    state.standing = rememberedPlace(a.realm, a.karta, a.name); // нормализованно, как и register
  }
  holdStanding(trim(socket), status ? trim(status) : deriveStatusUrl(trim(socket)));
  const block = listenBlock() ?? "";
  const content = reply.result?.content;
  if (Array.isArray(content)) {
    for (const c of content) if (typeof c?.text === "string") c.text = hideAddresses(c.text);
    content.push({ type: "text", text: block.trim() });
  }
  return reply;
}

/**
 * Своё снятие (revoke того стояния, что держит мост) — не смерть токена: сокет
 * отпускается прежде, чем придёт закрытие 4001, и привязка забывается, иначе
 * держатель объявляет «токен мёртв, зови connect», а послушный агент тут же
 * пересоздаёт снятое место (наблюдено в pi и OpenCode). Ответ сервера едет как есть.
 */

/** Зовёт ли этот вызов revoke то стояние, которое ведёт мост. */
function revokesOwn(msg: JsonRpcMessage): boolean {
  const a = msg?.params?.arguments;
  if (msg?.params?.name !== tool("channel") || a?.action !== "revoke") return false;
  const s = state.standing;
  if (!s || besideKeyIn(a.realm)) return false; // место другого графа снимается одно (absorbRevokeReply)
  return names(a, s) && !otherRealm(a.realm, s.realm);
}

/** Называет ли revoke это место — пустым, «mine», именем или полным адресом, и его ролью. */
function names(a: Record<string, unknown>, s: Standing): boolean {
  const asked = typeof a.standing === "string" ? a.standing.trim() : "";
  const own =
    asked === "" ||
    asked === "mine" ||
    asked === (s.name ?? "") ||
    asked.endsWith(`:${s.name ?? ""}`);
  return own && String(a.karta ?? s.karta) === String(s.karta);
}

/**
 * Перед отправкой своего revoke: закрытие 4001 приходит по сокету раньше, чем
 * ответ по HTTP, и без этой пометки мост объявил бы «токен мёртв, зови
 * connect» на месте, которое сам агент только что снял.
 */
export function expectOwnRevoke(msg: JsonRpcMessage): void {
  if (revokesOwn(msg)) setRevokingOwn(true);
  if (closesOwn(msg)) setClosingOwn(true);
}

/**
 * Своё close — канал места, которое ведёт мост, со всеми его местами (справка
 * iskron_channel, close): как своё снятие, не смерть токена (#6634).
 */
function closesOwn(msg: JsonRpcMessage): boolean {
  const a = msg?.params?.arguments;
  if (msg?.params?.name !== tool("channel") || a?.action !== "close") return false;
  const s = state.standing;
  return !!s && (!otherRealm(a.realm, s.realm) || !!besideKeyIn(a.realm)); // и граф места рядом — тот же канал
}

/**
 * Вызов кончился, ответа на него мост не впитал (упал, отказан транспортом):
 * пометка своего revoke/close снимается — иначе следующий настоящий мёртвый
 * токен отпустился бы тихо словом «токен жив».
 */
export function settleOwnRevoke(msg: JsonRpcMessage): void {
  if (msg?.params?.name !== tool("channel")) return;
  const action = msg.params.arguments?.action;
  if (action === "revoke") setRevokingOwn(false);
  if (action === "close") setClosingOwn(false);
}

export function absorbCloseReply(msg: JsonRpcMessage, reply: JsonRpcMessage): JsonRpcMessage {
  if (msg?.params?.name !== tool("channel") || msg?.params?.arguments?.action !== "close")
    return reply;
  setClosingOwn(false);
  // 4001 обогнал ответ — место уже отпущено (hold.ts), отпускать нечего.
  if (reply?.error || reply?.result?.isError || !closesOwn(msg)) return reply;
  releaseStanding(holdWords().closedOwn(), true, false, true);
  state.standing = null;
  state.standingSession = null;
  log("channel closed by this session — released quietly, binding forgotten");
  return reply;
}

export function absorbRevokeReply(msg: JsonRpcMessage, reply: JsonRpcMessage): JsonRpcMessage {
  if (msg?.params?.name !== tool("channel") || msg?.params?.arguments?.action !== "revoke")
    return reply;
  setRevokingOwn(false);
  const a = msg.params.arguments;
  if (reply?.error || reply?.result?.isError) {
    // Основное место канала сервер не снимает, пока на канале стоят места других
    // графов (#5186): отказ его — и слово моста, что именно держит канал (#5838).
    const held = extraPlaces().map((p) => p.door.key);
    const content = reply.result?.content;
    if (revokesOwn(msg) && held.length && Array.isArray(content))
      content.push({
        type: "text",
        text: L(
          `[iskron-bridge] ${state.standing?.name ?? "это место"} — основное место канала моста, а на канале стоят места других графов: ${held.join(", ")}. Мост ничего не отпустил; снять основное — сперва сними их (revoke в их графе).`,
          `[iskron-bridge] ${state.standing?.name ?? "this seat"} is the main seat of the bridge's channel, and seats of other graphs stand on the channel: ${held.join(", ")}. The bridge released nothing; to remove the main one, first remove them (revoke in their graph).`,
        ),
      });
    return reply;
  }
  const beside = extraIn(a.realm);
  if (beside && names(a, beside.standing)) {
    // Место другого графа снято своим revoke: его дверь и запись — прочь, канал цел (#5838).
    dropExtra(beside.door.key, holdWords().revokedOwn(), true, true);
    return reply;
  }
  if (!revokesOwn(msg)) return reply;
  const name = state.standing?.name ?? "unnamed";
  releaseStanding(holdWords().revokedOwn(), true, false, true);
  state.standing = null;
  state.standingSession = null;
  log(`standing revoked by this session — released quietly, binding forgotten (${name})`);
  return reply;
}
