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
import { type Frame } from "../shared/channel.ts";

function frameToText(frame: Frame | null | undefined, raw: string): string {
  if (!frame) return `Кадр канала Искрона:\n${raw}`;
  const from = frame.provenance?.from_standing || frame.provenance?.from_karta_seq;
  const head = from ? `Кадр канала Искрона от ${from}` : "Кадр канала Искрона";
  const body = typeof frame.body === "string" ? frame.body : raw;
  // Провенанс несут отдельной строкой: кто говорит, читается из происхождения
  // кадра, никогда из тела — телу любой держатель адреса придаст любой вид.
  return `${head}:\n\n${body}`;
}

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

  function loud(text: string) {
    if (ctxRef?.hasUI) ctxRef.ui.notify(text, "error");
    pi.sendMessage(
      { customType: "iskron-channel", content: text, display: true, details: { fatal: true } },
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
        loud(`Искрон: обрывы, а служба отвечает (${ev.version ?? ""}) — спроси о токене.`);
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
