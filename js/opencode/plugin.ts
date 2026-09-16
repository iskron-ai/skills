// Дверь Искрона в сессию OpenCode 2 — ОДИН плагин, три половины
// (граф nks-dev: #4266; устройство OpenCode — #4283: сервер держит много
// сессий, и у каждой корневой сессии свой мост, а значит своё стояние).
//
//   • тулы    — плагин поднимает мост дочерним процессом на каждую корневую
//               сессию и регистрирует каждый тул сервера под его собственным
//               именем (tools.ts);
//   • канал   — кадры стояния, которое держит мост сессии, входят в неё
//               промптом (channel.ts);
//   • команды — каждый установленный скилл поставки с `slash: true` становится
//               командой палитры «/» (commands.ts): OpenCode 2 сам ключ не
//               читает.
//
// Плагинная поверхность OpenCode 2 (граф nks-dev: поверхность v2): модуль с
// default-экспортом ОБЪЕКТА {id, setup(ctx)}; импортов ему не нужно — типы
// @opencode/plugin стираются сборкой. Файл лежит копией в
// ~/.config/opencode/plugins/iskron.js: оттуда OpenCode грузит файловые плагины,
// по разу на каждую локацию сервиса. Копию кладёт establish-mcp; doctor
// сличает её с поставкой.
import type { Plugin } from "@opencode/plugin";

import { setupChannel } from "./channel.ts";
import { setupCommands } from "./commands.ts";
import { type Say, setupTools } from "./tools.ts";

export type Context = Plugin.Context;

/* eslint-disable @typescript-eslint/no-explicit-any -- события и ответы SDK без схемы */

async function setup(ctx: Context): Promise<() => void> {
  // Тоста у серверного плагина OpenCode 2 нет: слово человеку — stderr сервиса,
  // а то, что должно дойти до агента, идёт промптом в его сессию (channel.ts).
  const say: Say = (text, level) => {
    process.stderr.write(`[iskron${level === "info" ? "" : "/" + level}] ${text}\n`);
  };

  // Корневые сессии, которые плагин видел, и когда: субагент делит мост
  // родителя (корень — по цепочке parentID), а кадр ничейного моста идёт в
  // свежайшую из виденных — списка сессий у контекста v2 нет.
  const roots = new Map<string, string>();
  const seen = new Map<string, number>();
  async function rootOf(sessionID: string): Promise<string> {
    const known = roots.get(sessionID);
    if (known) {
      seen.set(known, Date.now());
      return known;
    }
    let root = sessionID;
    try {
      const visited = new Set<string>();
      for (;;) {
        visited.add(root);
        const res: any = await ctx.session.get({ sessionID: root } as any);
        const parent: string | undefined = res?.parentID ?? res?.data?.parentID;
        if (!parent || visited.has(parent)) break;
        root = parent;
      }
    } catch {
      // Сессия не читается (например, ещё не легла на диск в миг session.created):
      // сейчас она сама себе корень, но не навсегда — иначе дочерняя сессия,
      // чей get упал однажды, поднимала бы свой мост и своё стояние (#4283).
      seen.set(root, Date.now());
      return root;
    }
    roots.set(sessionID, root);
    seen.set(root, Date.now());
    return root;
  }
  function freshestRoot(): string | null {
    let best: string | null = null;
    let at = -1;
    for (const [id, t] of seen) {
      if (t <= at) continue;
      best = id;
      at = t;
    }
    return best;
  }

  // Половины ставятся порознь и каждая под своим try: сорвавшаяся одна не
  // должна унести другую — и не должна унести загрузку плагина.
  let onChannel: (session: string | null, params: unknown) => void = () => {};
  try {
    const ch = setupChannel(ctx, say, freshestRoot);
    onChannel = (s, p) => ch.onEvent(s, p);
  } catch (e) {
    say(`Искрон: канал не встал — ${(e as Error).message}`, "error");
  }

  let half: Awaited<ReturnType<typeof setupTools>> = { forget() {}, stop() {} };
  try {
    half = await setupTools(ctx, say, onChannel, rootOf);
  } catch (e) {
    say(`Искрон: мост не поднялся — ${(e as Error).message}`, "error");
  }

  let commands: Awaited<ReturnType<typeof setupCommands>> = { refresh: async () => {} };
  try {
    commands = await setupCommands(ctx, say);
  } catch (e) {
    say(`Искрон: команды скиллов не встали — ${(e as Error).message}`, "error");
  }

  const controller = new AbortController();
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        const ev: any = event;
        const id: string | undefined = ev?.data?.sessionID;
        switch (ev?.type) {
          case "session.deleted":
            if (!id) break;
            roots.delete(id);
            seen.delete(id);
            half.forget(id);
            break;
          case "session.created":
            // data.parentID есть в самом событии: корень дочерней известен без чтения.
            if (!id) break;
            if (typeof ev.data?.parentID === "string") roots.set(id, ev.data.parentID);
            void rootOf(id);
            break;
          case "skill.updated":
            void commands.refresh();
            break;
        }
      }
    } catch {
      /* поток событий закрыт вместе с плагином */
    }
  })();

  return () => {
    controller.abort();
    half.stop();
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export default { id: "iskron", setup };
