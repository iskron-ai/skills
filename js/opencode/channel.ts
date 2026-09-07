// Половина «канал» — кадры стояния внутри сессии OpenCode (граф nks-dev: #4266).
//
// Сокет стояния держит мост (дочерний процесс плагина): переоткрывает, различает
// мёртвый токен, публикует занятость. Плагину остаётся то, чего у моста нет, —
// вложить кадр в сессию агента промптом (client.session.promptAsync): так кадр
// входит в идущий ход или поднимает простаивающего. Доставка есть возврат
// управления агенту; кадр, ушедший в лог или тост, — глушитель (урок контура
// opencode-плагина канала: делатель стоит глухим, считая себя слушающим).
//
// Куда доставлять: в сессию, что звала iskron_channel (она и держит стояние),
// иначе в последнюю, звавшую любой тул iskron_*, иначе в свежайшую корневую
// сессию сервера. Дочерние сессии (субагенты) адресатами не бывают.
import type { PluginInput } from "@opencode-ai/plugin";

import { type ChannelEvent } from "../bridge/hold.ts";
import { frameToText } from "../shared/frame-text.ts";

export type Say = (text: string, level: "info" | "warning" | "error") => void;

type Client = PluginInput["client"];

export interface Channel {
  /** Дверь половины «тулы»: сюда уходят уведомления моста. */
  onEvent(params: unknown): void;
  /** Половина «тулы» говорит, какая сессия звала какой тул. */
  noteCall(tool: string, sessionID: string | undefined): void;
  /** Сессия умерла — адресатом ей больше не быть. */
  forget(sessionID: string): void;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- уведомления моста и ответы SDK без схемы */

export function setupChannel(client: Client, say: Say): Channel {
  let channelSession: string | null = null;
  let lastSession: string | null = null;

  async function target(): Promise<string | null> {
    if (channelSession) return channelSession;
    if (lastSession) return lastSession;
    try {
      const res: any = await client.session.list();
      const roots = (res?.data ?? []).filter((s: any) => !s.parentID);
      roots.sort((a: any, b: any) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0));
      return roots[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  async function deliver(text: string): Promise<void> {
    const id = await target();
    if (!id) {
      say(
        "Искрон: кадр пришёл, а сессии, куда его вложить, нет — " + text.slice(0, 120),
        "warning",
      );
      return;
    }
    try {
      await client.session.promptAsync({
        path: { id },
        body: { parts: [{ type: "text", text }] },
      } as any);
    } catch (e) {
      say(`Искрон: кадр не вложился в сессию ${id}: ${(e as Error).message}`, "error");
    }
  }

  function loud(text: string): void {
    say(text, "error");
    void deliver(text);
  }

  return {
    noteCall(tool, sessionID) {
      if (!sessionID) return;
      lastSession = sessionID;
      if (tool === "iskron_channel") channelSession = sessionID;
    },
    forget(sessionID) {
      if (channelSession === sessionID) channelSession = null;
      if (lastSession === sessionID) lastSession = null;
    },
    onEvent(params: any) {
      const ev = params?.data as ChannelEvent | undefined;
      if (!ev || typeof ev !== "object") return;
      switch (ev.kind) {
        case "frame": {
          const frame = ev.frame ?? null;
          // Служебные кадры не будят: hello доказывает, что сокет держат, и только.
          if (frame?.type === "hello") return say("Искрон: канал слушает", "info");
          if (frame?.type === "status") return;
          void deliver(frameToText(frame, ev.raw ?? ""));
          return;
        }
        case "dead":
          loud(
            `Искрон: канал закрыт кодом ${ev.code} — токен мёртв. Зови iskron_channel(action="connect")` +
              (ev.code === 4001 ? ' или action="mint"' : "") +
              ", затем register тем же именем: новый сокет мост возьмёт из ответа сам, перезапуск не нужен.",
          );
          return;
        case "alive":
          loud(`Искрон: обрывы, а служба отвечает (${ev.version ?? ""}) — спроси о токене.`);
          return;
        case "note":
          if (ev.text) say(`Искрон: ${ev.text}`, "warning");
          return;
        default:
          return;
      }
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
