// Половина «канал» — кадры стояния внутри сессии pi.
//
// Сокет стояния держит мост (дочерний процесс этой же сессии): он берёт адрес
// из ответа connect, переоткрывает по обрыву, различает мёртвый токен и
// выкатку и публикует занятость. Расширению остаётся то, чего у моста нет, —
// вложить пришедший кадр в идущий ход и поднять ход у простаивающего агента:
// `pi.sendMessage(..., { triggerTurn: true })`. Кадры приходят стандартным
// уведомлением MCP `notifications/message` с logger «iskron-channel»; половина
// «тулы» подаёт их сюда как есть.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { type ChannelEvent } from "../bridge/hold.ts";
import { frameToText } from "../shared/frame-text.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- контекст pi здесь читается по двум полям */

/**
 * Половина «канал»: свои обработчики, своё состояние, свой отказ.
 * Возвращает дверь, которой половина «тулы» подаёт сюда уведомления моста.
 */
export function setupChannel(pi: ExtensionAPI): (params: any) => void {
  let ctxRef: any = null;

  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;
  });
  pi.on("session_shutdown", async () => {
    ctxRef = null;
  });

  // fatal — держание кончилось (мёртвый токен); без него — слово в ход, держание идёт.
  function loud(text: string, fatal = true) {
    if (ctxRef?.hasUI) ctxRef.ui.notify(text, fatal ? "error" : "warning");
    pi.sendMessage(
      { customType: "iskron-channel", content: text, display: true, details: { fatal } },
      { triggerTurn: true, deliverAs: "steer" },
    );
  }

  return (params: any) => {
    const ev = params?.data as ChannelEvent | undefined;
    if (!ev || typeof ev !== "object") return;
    switch (ev.kind) {
      case "frame": {
        const frame = ev.frame ?? null;
        const raw = ev.raw ?? "";
        // Служебные кадры не будят: hello доказывает, что сокет держат, и только.
        if (frame?.type === "hello") {
          // setStatus — пара (ключ, текст); один аргумент кладёт строку в ключ
          // и оставляет её без текста, то есть невидимой.
          if (ctxRef?.hasUI) ctxRef.ui.setStatus?.("iskron", "Искрон: канал слушает");
          return;
        }
        if (frame?.type === "status") return;
        // Вот ради чего всё: кадр входит в идущий ход, а простаивающего агента
        // поднимает. Это и есть то, чего у сторожа-процесса быть не может.
        pi.sendMessage(
          {
            customType: "iskron-channel",
            content: frameToText(frame, raw),
            display: true,
            details: frame ?? { raw },
          },
          { triggerTurn: true, deliverAs: "steer" },
        );
        return;
      }
      case "dead":
        // Процессу здесь выйти некуда, поэтому громкость — это сказать делателю
        // так, чтобы он это увидел в ходе, а не в логе, которого никто не читает.
        loud(
          `Искрон: канал закрыт кодом ${ev.code} — токен мёртв. Зови iskron_channel(action="connect")` +
            (ev.code === 4001 ? ' или action="mint"' : "") +
            ", затем register тем же именем: новый сокет мост возьмёт из ответа сам, перезапуск не нужен.",
        );
        return;
      case "alive":
        loud(
          `Искрон: сокет рвут, а служба отвечает (${ev.version ?? ""}) — мост держит место и переоткрывает реже; ` +
            "не пройдёт — спроси о токене.",
          false,
        );
        return;
      case "note":
        if (ctxRef?.hasUI && ev.text) ctxRef.ui.notify(`Искрон: ${ev.text}`, "warning");
        return;
      case "attached":
      case "released":
        return;
    }
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
