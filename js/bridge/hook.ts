// Хук инбокса роли в iskron_stand — чтобы вимарша posed_to приходила тем же
// сокетом. Место основного графа будит свой входящий адрес. Место другого
// графа на том же канале своего адреса не имеет: адрес (hook_token) — у канала
// и привязан к графу, где канал открыт; хук роли в этом графе ставится на канал
// телом {"channel":"self"}, и доставка идёт внутри службы — в очередь мест роли
// этого графа на живых сокетах, с to_standing_id места (#5838, слово
// держателя API). Мост ходит к хукам тулом iskron_admin(action="add_webhook");
// channel он передаёт, только если схема тула этот параметр объявляет.
import { callTool as call, short } from "./call.ts";
import { post, state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

/** Параметры iskron_admin по схеме сервера — один запрос tools/list на процесс. */
let adminParams: Promise<Set<string>> | null = null;
function adminParamNames(): Promise<Set<string>> {
  adminParams ??= (async () => {
    const id = `iskron-bridge-admin-schema-${++state.reinitCounter}`;
    let got: JsonRpcMessage | null = null;
    await post({ jsonrpc: "2.0", id, method: "tools/list", params: {} }, (m) => {
      if (m.id === id) got = m;
    }).catch(() => {});
    const tools = (got as JsonRpcMessage | null)?.result?.tools;
    const admin = Array.isArray(tools)
      ? (tools as { name?: string; inputSchema?: { properties?: Record<string, unknown> } }[]).find(
          (t) => t?.name === "iskron_admin",
        )
      : undefined;
    const names = new Set(Object.keys(admin?.inputSchema?.properties ?? {}));
    if (!names.size) adminParams = null; // схемы не видно — спросить в следующий раз
    return names;
  })();
  return adminParams;
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
  if (p.sub)
    return "Хук инбокса роли: отдельному месту не взводится — почту роли слушает основное место, комнаты доставляют своё сами.";
  if (wakesMe) return "Хук инбокса роли: стоит и будит это стояние.";
  if (!recognized)
    return `Хук инбокса роли: список хуков не распознан — не трогаю (${short(hooks.text, 120)}).`;
  if (!p.heardHere) return "Хук инбокса роли: не взвожу — слух у другого держателя.";
  if (p.beside) {
    // Своего адреса у места нет — хук ставится на канал, если тул это умеет.
    if (!(await adminParamNames()).has("channel"))
      return `Хук инбокса роли: не взведён — у места этого графа своего входящего адреса нет (адрес — у канала, открытого в графе ${p.channelRealm}), а тул iskron_admin(action="add_webhook") в этой поверхности параметра channel не объявляет; хук на канал (channel=self) взвести нечем — почта роли этого графа сокетом не приходит.`;
    const h = await call("iskron_admin", {
      action: "add_webhook",
      realm,
      node_id: karta,
      channel: "self",
    });
    return h.isError
      ? `Хук инбокса роли: на канал (channel=self) не взвёлся — ${short(h.text)}`
      : `Хук инбокса роли: взведён на канал (channel=self) — почта роли этого графа идёт в тот же сокет месту этого графа (${short(h.text, 120)}).`;
  }
  if (!p.incoming) return "Хук инбокса роли: не взведён — входящий адрес стояния не прочитался.";
  const h = await call("iskron_admin", {
    action: "add_webhook",
    realm,
    node_id: karta,
    url: p.incoming, // без ttl_seconds: 0 снимает срок только в update_webhook; на добавлении его отвергает контур (слово архитектора, #5380)
  });
  return h.isError
    ? `Хук инбокса роли: не взвёлся — ${short(h.text)}`
    : `Хук инбокса роли: взведён на входящий адрес места (${short(h.text, 120)}).`;
}
