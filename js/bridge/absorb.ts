// Ответ connect/mint и своё снятие — что мост берёт из проксируемых ответов
// канала (граф nks-dev: #4233, #5033). Секрет сокета вырезается, держание
// уходит в hold.ts; своё revoke отпускает место тихо (#5012).
import { statusUrl as deriveStatusUrl } from "../shared/channel.ts";
import { holdStanding, releaseStanding, setRevokingOwn } from "./hold.ts";
import { listenBlock } from "./listen.ts";
import { rememberedPlace, replyText } from "./standing.ts";
import { log } from "./streams.ts";
import { state } from "./transport.ts";
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
      "(адрес сокета держит мост — агенту не показывается)",
    )
    .replace(new RegExp(STATUS_RE.source, "g"), "(статусный адрес держит мост)");

/**
 * Ответ connect/mint прошёл через мост: взять из него сокет и держать, а сам
 * ответ дополнить тем, чего сервер знать не может, — точной командой слушания
 * и путём файла занятости. Возвращает дополненный ответ либо исходный.
 */
export function absorbChannelReply(msg: JsonRpcMessage, reply: JsonRpcMessage): JsonRpcMessage {
  const a = msg?.params?.arguments;
  if (msg?.params?.name !== "iskron_channel") return reply;
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
  if (msg?.params?.name !== "iskron_channel" || a?.action !== "revoke") return false;
  const s = state.standing;
  if (!s) return false;
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
}

export function absorbRevokeReply(msg: JsonRpcMessage, reply: JsonRpcMessage): JsonRpcMessage {
  if (msg?.params?.name !== "iskron_channel" || msg?.params?.arguments?.action !== "revoke")
    return reply;
  setRevokingOwn(false);
  if (reply?.error || reply?.result?.isError) return reply;
  if (!revokesOwn(msg)) return reply;
  const name = state.standing?.name ?? "unnamed";
  releaseStanding("снято своим revoke", true);
  state.standing = null;
  state.standingSession = null;
  log(`standing revoked by this session — released quietly, binding forgotten (${name})`);
  return reply;
}
