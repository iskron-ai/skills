// Дверь Искрона в сессию OpenCode — ОДИН плагин, две независимые половины
// (граф nks-dev: #4266; тот же замысел, что у расширения pi, с одной поправкой
// на устройство OpenCode — #4283: сервер держит много сессий, и у каждой
// корневой сессии свой мост, а значит своё стояние).
//
//   • тулы   — плагин поднимает мост дочерним процессом на каждую корневую
//              сессию и регистрирует каждый тул сервера под его собственным
//              именем (tools.ts);
//   • канал  — кадры стояния, которое держит мост сессии, входят в неё
//              промптом (channel.ts).
//
// Файл лежит копией в ~/.config/opencode/plugins/iskron.js: там, и только там,
// OpenCode сам держит node_modules с @opencode-ai/plugin, единственным внешним
// импортом этого модуля. Копию кладёт establish-mcp; doctor сличает её с поставкой.
//
// Экспорт — только функции: загрузчик OpenCode перебирает все экспорты модуля и
// падает на любом не-функции.
import type { Hooks, Plugin } from "@opencode-ai/plugin";

import { type Say, setupChannel } from "./channel.ts";
import { setupTools } from "./tools.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- ответы SDK без схемы */

const IskronPlugin: Plugin = async ({ client }) => {
  const say: Say = (text, level) => {
    process.stderr.write(`[iskron] ${text}\n`);
    // Тост — для человека в TUI; без TUI вызов отказывает, и это не событие.
    void client.tui
      .showToast({ body: { message: text, variant: level === "warning" ? "warning" : level } })
      .catch(() => {});
  };

  // Субагент делит мост родителя: корень сессии — по цепочке parentID.
  const roots = new Map<string, string>();
  async function rootOf(sessionID: string): Promise<string> {
    const known = roots.get(sessionID);
    if (known) return known;
    let root = sessionID;
    try {
      const seen = new Set<string>();
      for (;;) {
        seen.add(root);
        const res: any = await client.session.get({ path: { id: root } } as any);
        const parent: string | undefined = res?.data?.parentID;
        if (!parent || seen.has(parent)) break;
        root = parent;
      }
    } catch {
      /* сессия не читается — она сама себе корень */
    }
    roots.set(sessionID, root);
    return root;
  }

  // Половины ставятся порознь и каждая под своим try: сорвавшаяся одна не
  // должна унести другую — и не должна унести загрузку плагина.
  let onChannel: (session: string | null, params: unknown) => void = () => {};
  try {
    const ch = setupChannel(client, say);
    onChannel = (s, p) => ch.onEvent(s, p);
  } catch (e) {
    say(`Искрон: канал не встал — ${(e as Error).message}`, "error");
  }

  let half: Awaited<ReturnType<typeof setupTools>> = { tools: {}, forget() {}, stop() {} };
  try {
    half = await setupTools(say, onChannel, rootOf);
  } catch (e) {
    say(`Искрон: мост не поднялся — ${(e as Error).message}`, "error");
  }

  const hooks: Hooks = {
    tool: half.tools,
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const id = (event.properties as { info: { id: string } }).info.id;
        roots.delete(id);
        half.forget(id);
      }
    },
    dispose: async () => half.stop(),
  };
  return hooks;
};

/* eslint-enable @typescript-eslint/no-explicit-any */

export default IskronPlugin;
