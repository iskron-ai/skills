// Хук инбокса роли в iskron_stand — чтобы вимарша posed_to приходила тем же
// сокетом. Место основного графа будит свой входящий адрес. Место другого
// графа на том же канале своего адреса не имеет: адрес (hook_token) — у канала
// и привязан к графу, где канал открыт; хук роли в этом графе ставится на канал
// телом {"channel":"self"}, и доставка идёт внутри службы — в очередь мест роли
// этого графа на живых сокетах, с to_standing_id места (#5838, слово
// держателя API). Мост ходит к хукам тулом iskron_admin(action="add_webhook");
// channel он передаёт, только если схема тула этот параметр объявляет.
import { L } from "../shared/lang.ts";
import { callTool as call, short } from "./call.ts";
import { post, state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

/**
 * Параметры iskron_admin по схеме сервера — читаются заново на каждый iskron_stand:
 * работающий мост подхватывает channel, как только сервер его объявит. null —
 * схему прочесть не удалось (tools/list отказал, пуст или тул на другой странице).
 */
async function adminParamNames(): Promise<Set<string> | null> {
  const id = `iskron-bridge-admin-schema-${++state.reinitCounter}`;
  let got: JsonRpcMessage | null = null;
  try {
    await post({ jsonrpc: "2.0", id, method: "tools/list", params: {} }, (m) => {
      if (m.id === id) got = m;
    });
  } catch {
    return null;
  }
  const result = (got as JsonRpcMessage | null)?.result;
  const tools = result?.tools;
  if (!Array.isArray(tools)) return null;
  const admin = (
    tools as { name?: string; inputSchema?: { properties?: Record<string, unknown> } }[]
  ).find((t) => t?.name === "iskron_admin");
  if (!admin) return null; // тула на этой странице нет (список постраничный или урезан) — схема не прочтена
  return new Set(Object.keys(admin.inputSchema?.properties ?? {}));
}

export interface HookPlace {
  realm: string;
  karta: string;
  name: string;
  /** входящий адрес места — только у места графа, где открыт канал */
  incoming: string | null;
  heardHere: boolean;
  /** отдельное место имя.N — хук роли ему не взводится */
  sub: boolean;
  /** место другого графа на канале этого моста */
  beside: boolean;
  /** граф, где открыт канал (основное место) — для слова об адресе */
  channelRealm: string;
}

/** Шаг хука инбокса роли; возвращает строку ответа iskron_stand. */
export async function armRoleHook(p: HookPlace): Promise<string> {
  const { realm, karta, name } = p;
  const hooks = await call("iskron_admin", { action: "list_webhooks", realm, node_id: karta });
  // Пустой список поверхность печатает без заголовка: «Для #N вебхуки не зарегистрированы.» (#5380).
  const recognized =
    !hooks.isError &&
    (/^\s*Вебхуки(?:\s|:|\(|$)/m.test(hooks.text) ||
      /вебхуки не зарегистрированы/i.test(hooks.text));
  const nameRe = new RegExp(`:${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9._-])`);
  const wakesMe =
    recognized &&
    hooks.text.split(/\n(?=\s*#\d+\s*→)/).some((b) => /активен/.test(b) && nameRe.test(b));
  const H = L("Хук инбокса роли", "Role inbox hook");
  if (p.sub)
    return L(
      `${H}: отдельному месту не взводится — почту роли слушает основное место, дела доставляют своё сами.`,
      `${H}: not armed for a separate seat — the main seat listens to the role's mail, cases deliver their own.`,
    );
  if (wakesMe)
    return L(`${H}: стоит и будит это стояние.`, `${H}: in place and wakes this standing.`);
  if (!recognized)
    return L(
      `${H}: список хуков не распознан — не трогаю (${short(hooks.text, 120)}).`,
      `${H}: the hook list is not recognized — left alone (${short(hooks.text, 120)}).`,
    );
  if (!p.heardHere)
    return L(
      `${H}: не взвожу — слух у другого держателя.`,
      `${H}: not armed — another holder has the hearing.`,
    );
  if (p.beside) {
    // Своего адреса у места нет — хук ставится на канал, если тул это умеет.
    const params = await adminParamNames();
    const noAddress = L(
      `у места этого графа своего входящего адреса нет (адрес — у канала, открытого в графе ${p.channelRealm})`,
      `this graph's seat has no incoming address of its own (the address is the channel's, opened in graph ${p.channelRealm})`,
    );
    if (!params)
      return L(
        `${H}: не взведён — ${noAddress}, а схему тула iskron_admin прочесть не удалось (tools/list не ответил или iskron_admin в нём не нашёлся) — объявлен ли параметр channel, не известно; хук на канал (channel=self) не взвожу вслепую — повтори iskron_stand этого графа.`,
        `${H}: not armed — ${noAddress}, and the iskron_admin schema could not be read (tools/list did not answer or has no iskron_admin) — whether it declares channel is unknown; no blind hook on the channel (channel=self) — repeat iskron_stand for this graph.`,
      );
    if (!params.has("channel"))
      return L(
        `${H}: не взведён — ${noAddress}, а тул iskron_admin(action="add_webhook") в этой поверхности параметра channel не объявляет; хук на канал (channel=self) взвести нечем — почта роли этого графа сокетом не приходит.`,
        `${H}: not armed — ${noAddress}, and iskron_admin(action="add_webhook") on this surface declares no channel parameter; nothing to arm a channel hook (channel=self) with — this graph's role mail does not come over the socket.`,
      );
    const h = await call("iskron_admin", {
      action: "add_webhook",
      realm,
      node_id: karta,
      channel: "self",
    });
    return h.isError
      ? L(
          `${H}: на канал (channel=self) не взвёлся — ${short(h.text)}`,
          `${H}: not armed on the channel (channel=self) — ${short(h.text)}`,
        )
      : L(
          `${H}: взведён на канал (channel=self) — почта роли этого графа идёт в тот же сокет месту этого графа (${short(h.text, 120)}).`,
          `${H}: armed on the channel (channel=self) — this graph's role mail goes into the same socket to this graph's seat (${short(h.text, 120)}).`,
        );
  }
  if (!p.incoming)
    return L(
      `${H}: не взведён — входящий адрес стояния не прочитался.`,
      `${H}: not armed — the standing's incoming address did not read.`,
    );
  const h = await call("iskron_admin", {
    action: "add_webhook",
    realm,
    node_id: karta,
    url: p.incoming, // без ttl_seconds: 0 снимает срок только в update_webhook; на добавлении его отвергает контур (слово архитектора, #5380)
  });
  return h.isError
    ? L(`${H}: не взвёлся — ${short(h.text)}`, `${H}: not armed — ${short(h.text)}`)
    : L(
        `${H}: взведён на входящий адрес места (${short(h.text, 120)}).`,
        `${H}: armed on the seat's incoming address (${short(h.text, 120)}).`,
      );
}
