// Половина «канал» — кадры стояния внутри сессии OpenCode (граф nks-dev: #4266).
//
// Сокет стояния держит мост сессии (дочерний процесс плагина, свой у каждой
// корневой сессии): переоткрывает, различает мёртвый токен, публикует
// занятость. Плагину остаётся то, чего у моста нет, — вложить кадр в сессию
// агента промптом (client.session.promptAsync): так кадр входит в идущий ход
// или поднимает простаивающего. Доставка есть возврат управления агенту;
// кадр, ушедший в лог или тост, — глушитель (урок контура opencode-плагина
// канала: делатель стоит глухим, считая себя слушающим).
//
// Адресат — сессия, чей мост принёс кадр: адрес приходит вместе с событием,
// угадывать нечего. Кадр от моста, ещё никому не отданного, идёт в свежайшую
// корневую сессию сервера; дочерние сессии (субагенты) адресатами не бывают.
import type { PluginInput } from "@opencode-ai/plugin";

import { type ChannelEvent } from "../bridge/hold.ts";
import { frameToText } from "../shared/frame-text.ts";

export type Say = (text: string, level: "info" | "warning" | "error") => void;

type Client = PluginInput["client"];

export interface Channel {
  /** Дверь половины «тулы»: событие моста сессии `session` (null — мост ещё ничей). */
  onEvent(session: string | null, params: unknown): void;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- уведомления моста и ответы SDK без схемы */

export function setupChannel(client: Client, say: Say): Channel {
  async function freshestRoot(): Promise<string | null> {
    try {
      const res: any = await client.session.list();
      const roots = (res?.data ?? []).filter((s: any) => !s.parentID);
      roots.sort((a: any, b: any) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0));
      return roots[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  async function deliver(session: string | null, text: string): Promise<void> {
    const id = session ?? (await freshestRoot());
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

  function loud(session: string | null, text: string): void {
    say(text, "error");
    void deliver(session, text);
  }

  return {
    onEvent(session, params: any) {
      const ev = params?.data as ChannelEvent | undefined;
      if (!ev || typeof ev !== "object") return;
      switch (ev.kind) {
        case "frame": {
          const frame = ev.frame ?? null;
          // Служебные кадры не будят: hello доказывает, что сокет держат, и только.
          if (frame?.type === "hello") return say("Искрон: канал слушает", "info");
          if (frame?.type === "status") return;
          void deliver(session, frameToText(frame, ev.raw ?? ""));
          return;
        }
        case "dead":
          loud(
            session,
            `Искрон: канал закрыт кодом ${ev.code} — токен мёртв. Зови iskron_channel(action="connect")` +
              (ev.code === 4001 ? ' или action="mint"' : "") +
              ", затем register тем же именем: новый сокет мост возьмёт из ответа сам, перезапуск не нужен.",
          );
          return;
        case "alive":
          loud(
            session,
            `Искрон: обрывы, а служба отвечает (${ev.version ?? ""}) — спроси о токене.`,
          );
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
