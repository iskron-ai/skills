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
import { envName } from "../delivery/index.ts";
import { addressedToMine } from "../shared/addressed.ts";
import { type Frame } from "../shared/channel.ts";
import { batchHead, batchLines, frameToText } from "../shared/frame-text.ts";
import { byKind, roomKind, stackOf } from "../shared/room-kinds.ts";
import { deliveryKeys, eventIn, isTact, onlyTacts, tactAt } from "../shared/seen.ts";

/** Окно свёртки неадресованных кадров дела; переменная — шов для проб. */
const ASIDE_MS = Number(process.env[envName("PI_ASIDE_MS")]) || 3_000;
/** Как часто ждущий такт спрашивает, свободен ли ход. */
const TACT_POLL_MS = 1_000;

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

  // Записи дел, не адресованные месту (#6574), копятся коротким окном и уходят
  // одной записью к следующему ходу (nextTurn: не прерывает и не поднимает):
  // счёт по делам с адресованными строками, без текста прочего.
  const aside: Frame[] = [];
  let asideTimer: ReturnType<typeof setTimeout> | null = null;
  /** Метки внесённого в ход текстом (seen.ts deliveryKeys): счёт свёртки их не повторит. */
  const marks = new Set<string>();
  function noteText(keys: string[] | undefined): void {
    for (const k of keys ?? []) marks.add(k);
    for (const old of marks) if (marks.size > 500) marks.delete(old);
  }
  function flushAsides(): void {
    if (asideTimer) clearTimeout(asideTimer);
    asideTimer = null;
    const got = aside.splice(0).filter((f) => !eventIn(f, (k) => marks.has(k)));
    if (!got.length) return;
    pi.sendMessage(
      {
        customType: "iskron-channel",
        content: [batchHead(got), ...batchLines(got)].join("\n"),
        display: true,
        details: { count: got.map((f) => f.id ?? null) },
      },
      { triggerTurn: false, deliverAs: "nextTurn" },
    );
  }

  // Одна пачка — одно слово в ход: лежалые кадры или побудка с накопленным.
  function sendBatch(ev: ChannelEvent): void {
    pi.sendMessage(
      {
        customType: "iskron-channel",
        content: ev.text ?? "",
        display: true,
        details: ev.kind === "stale" ? { stale: true } : { backlog: true },
      },
      { triggerTurn: true, deliverAs: "steer" },
    );
  }

  // Такт внимания, ждущий конца занятого хода (#6569): освободившись, агент видит последний.
  // Конец хода — agent_end, а такт, пришедший, пока его обработчики идут, ждущий ловит опросом.
  let tact: ChannelEvent | null = null;
  let tactPoll: ReturnType<typeof setInterval> | null = null;
  function releaseTact(): void {
    if (tactPoll) clearInterval(tactPoll);
    tactPoll = null;
    const t = tact;
    tact = null;
    if (t) sendBatch(t);
  }
  /** Такт пачки принят платформой раньше ждущего — лежалая пачка приходит позже живого. */
  function olderTact(ev: ChannelEvent): boolean {
    const at = tactAt(ev.frames);
    const was = tact ? tactAt(tact.frames) : "";
    return !!at && !!was && at < was;
  }
  function holdTact(ev: ChannelEvent): void {
    if (olderTact(ev)) return; // ждущий новее — этот свёрнут
    tact = ev;
    tactPoll ??= setInterval(() => {
      if (ctxRef?.isIdle?.() !== false) releaseTact();
    }, TACT_POLL_MS);
    (tactPoll as { unref?: () => void }).unref?.();
  }
  pi.on("agent_end", async () => releaseTact());

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
        // Запись дела, не адресованная месту (#6574), — в свёртку числом, без
        // побудки и без текста; адресованное — само, текстом.
        if (frame && (byKind(frame) || roomKind(frame)?.aside) && !addressedToMine(frame)) {
          aside.push(frame);
          asideTimer ??= setTimeout(flushAsides, ASIDE_MS);
          (asideTimer as { unref?: () => void }).unref?.();
          return;
        }
        noteText(deliveryKeys(frame)); // кадр входит текстом — свёртка его событие не повторит
        flushAsides(); // накопленное — прежде следующего кадра: порядок цел
        // Кадр комнаты с event_kind рода «в пачку» (словарь родов, #5851) ход не
        // режет — ждёт его конца; кадр без event_kind — прежним путём, вставкой.
        const later = byKind(frame) && stackOf(frame) === "batch";
        pi.sendMessage(
          {
            customType: "iskron-channel",
            content: frameToText(frame, raw),
            display: true,
            details: frame ?? { raw },
          },
          { triggerTurn: true, deliverAs: later ? "followUp" : "steer" },
        );
        return;
      }
      case "dead":
        // Процессу здесь выйти некуда, поэтому громкость — это сказать делателю
        // так, чтобы он это увидел в ходе, а не в логе, которого никто не читает.
        loud(
          `Искрон: канал закрыт кодом ${ev.code} — токен мёртв. Зови iskron_channel(action="connect")` +
            ", затем register тем же именем: новый сокет мост возьмёт из ответа сам, перезапуск не нужен.",
        );
        return;
      case "stale":
      case "backlog":
        noteText(ev.marks); // метки пачки — внесённое ею в ход
        if (!ev.text) return;
        // Такт внимания в занятый ход не входит: ждёт его конца, новый вытесняет ждущий (seen.ts foldedTacts).
        if (onlyTacts(ev.frames) && ctxRef?.isIdle?.() === false) return holdTact(ev);
        if (ev.frames?.some(isTact) && !olderTact(ev)) tact = null;
        sendBatch(ev);
        return;
      case "evicted":
        loud(
          `Искрон: канал закрыт кодом ${ev.code} — место отняли, слушает другой держатель. ` +
            "Мост сам встаёт рядом на имя.N со слухом — своё место, чужое не перехватывается; исход — следующим словом, место и команду сторожа скажет iskron_stand тем же вызовом. Вытеснить ту сессию (take=true) — только словом человека.",
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
      case "held":
      case "released":
      case "lost":
      case "resumed":
        return;
    }
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
