// Дверь Искрона в сессию OpenCode — ОДИН плагин, две независимые половины
// (граф nks-dev: #4266; тот же замысел, что у расширения pi).
//
//   • тулы   — плагин поднимает мост дочерним процессом и регистрирует каждый
//              тул сервера под его собственным именем (tools.ts);
//   • канал  — кадры стояния, которое держит мост, входят в сессию промптом
//              (channel.ts).
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

const IskronPlugin: Plugin = async ({ client }) => {
  const say: Say = (text, level) => {
    process.stderr.write(`[iskron] ${text}\n`);
    // Тост — для человека в TUI; без TUI вызов отказывает, и это не событие.
    void client.tui
      .showToast({ body: { message: text, variant: level === "warning" ? "warning" : level } })
      .catch(() => {});
  };

  // Половины ставятся порознь и каждая под своим try: сорвавшаяся одна не
  // должна унести другую — и не должна унести загрузку плагина.
  let onChannel: (params: unknown) => void = () => {};
  let noteCall: (tool: string, sessionID: string | undefined) => void = () => {};
  let forget: (sessionID: string) => void = () => {};
  try {
    const ch = setupChannel(client, say);
    onChannel = (p) => ch.onEvent(p);
    noteCall = (t, s) => ch.noteCall(t, s);
    forget = (s) => ch.forget(s);
  } catch (e) {
    say(`Искрон: канал не встал — ${(e as Error).message}`, "error");
  }

  let half: Awaited<ReturnType<typeof setupTools>> = { tools: {}, stop() {} };
  try {
    half = await setupTools(say, onChannel, noteCall);
  } catch (e) {
    say(`Искрон: мост не поднялся — ${(e as Error).message}`, "error");
  }

  const hooks: Hooks = {
    tool: half.tools,
    event: async ({ event }) => {
      if (event.type === "session.deleted")
        forget((event.properties as { info: { id: string } }).info.id);
    },
    dispose: async () => half.stop(),
  };
  return hooks;
};

export default IskronPlugin;
