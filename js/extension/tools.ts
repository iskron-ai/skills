// Половина «тулы» — тулы Искрона через мост.
//
// Расширение само говорит с мостом по MCP stdio и регистрирует КАЖДЫЙ тул
// сервера под его собственным именем.
//
// Почему не прокси-тул. Корпус скиллов написан императивами вида «позови
// iskron_orient», «передай action="?"». Поставка, прячущая тулы сервера за одним
// проксирующим вызовом, делает каждую такую фразу ложной — скилл называет имя,
// которого в сессии нет. Поэтому имена здесь сквозные: что отдал `tools/list`,
// то и стоит в сессии.
//
// Схема параметров идёт от моста БЕЗ конверсии — решение, а не лень. pi отдаёт
// `parameters` провайдеру как есть (`getJsonSchemaToolParameters`), а валидатор
// pi-ai (`validateToolArguments`) имеет отдельную ветку для схем без символа
// `Symbol.for("TypeBox.Kind")`, то есть для обычного JSON Schema. Строковый enum
// на этой поверхности уже приходит в форме `{"type":"string","enum":[…]}` —
// ровно то, что строит `StringEnum` из @earendil-works/pi-ai
// (`Type.Unsafe({type:"string",enum})`), поэтому оговорка доков про Google
// исполнена сама собой, и конвертировать нечего.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { Bridge, resultToContent, snippet, toParameters } from "../shared/bridge-client.ts";
import { PI_CLIENT } from "../shared/clients.ts";
import { findBridge, type Notify, refreshHomeBridge } from "./home-copy.ts";

export type ChannelEventSink = (params: any) => void;

/** Сколько ждать поднятия моста, ПРЕЖДЕ чем отпустить старт сессии. */
const READY_WAIT_MS = Number(process.env.ISKRON_MCP_READY_WAIT_MS || 20000);
/** Потолок самого рукопожатия. Щедрый: первый запуск уводит человека в браузер. */
const HANDSHAKE_MS = Number(process.env.ISKRON_MCP_HANDSHAKE_MS || 600000);
/** Такт «я ещё жду» у долгого вызова. */
const TICK_MS = 15000;
/** Такт повтора рукопожатия, пока мост ждёт входа человека. */
const AUTH_POLL_MS = Number(process.env.ISKRON_MCP_AUTH_POLL_MS || 3000);
/** Отказ моста «нужен вход»: вход опубликован, мост держит его — гасить мост нельзя (#4795). Форма — та же, что читает плагин OpenCode. */
const AUTH_PENDING = /authorization required/i;

const PROTOCOL = "2025-06-18";

/* eslint-disable @typescript-eslint/no-explicit-any -- ответы моста приходят без схемы */

/**
 * Половина «тулы»: свои обработчики, своё состояние, свой отказ.
 * `onChannel` — дверь половины «канал»: сюда уходят уведомления дочернего моста
 * о кадрах стояния. Сокет держит мост; расширение видит только события.
 */
export function setupBridge(pi: ExtensionAPI, onChannel: ChannelEventSink): void {
  let bridge: Bridge | null = null;
  let notify: Notify = () => {};
  // Голос сессии: без UI сказать некому, и это условие отказа от подмены моста,
  // а не мелочь — см. refreshHomeBridge.
  let canSpeak = false;

  async function raise(): Promise<void> {
    // Прежде поиска: если поставка привезла мост новее домашнего — обновить, вслух.
    // Порядок несущий: обновляем ДО подъёма, иначе новый мост побежал бы только
    // со следующей сессии, а эта осталась бы на старом, уже сказав, что обновилась.
    refreshHomeBridge(notify, canSpeak);
    const found = findBridge();
    if (!found.path) {
      notify(
        "Искрон: мост не найден — тулов iskron_* в этой сессии не будет. Искал: " +
          found.tried.join(", ") +
          ". Задай ISKRON_BRIDGE_PATH или поставь мост скиллом establish-mcp.",
        "error",
      );
      return;
    }

    const b = new Bridge(
      found.path,
      (line) => notify(`Искрон/мост: ${line}`, "info"),
      (method, params) => {
        // Кадры стояния мост шлёт стандартным уведомлением с logger iskron-channel.
        if (method === "notifications/message" && params?.logger === "iskron-channel")
          onChannel(params);
        // Сервер сменил тулы под переоткрытой сессией моста: перечитать и зарегистрировать (#5406).
        if (method === "notifications/tools/list_changed") void relist(b);
      },
    );
    bridge = b;
    b.start();

    // Отказ «нужен вход» — не поломка: мост опубликовал вход и держит его
    // слушателем на своём порту; погасить мост значило бы увести клик человека в
    // отказ соединения (граф nks-dev: #4795, тот же класс — #4712). Расширение
    // говорит человеку ссылку и повторяет рукопожатие, пока грант не ляжет.
    // Ждётся ровно отказ входа — по его слову, не по коду: код -32001 у моста
    // носит и сеть, и мёртвый токен, а они — «мост не поднялся», как прежде.
    // Ожидание ограничено потолком рукопожатия и кончается со сменой сессии.
    let toldLogin = false;
    const deadline = Date.now() + HANDSHAKE_MS;
    const untilAuthed = async <T>(ask: () => Promise<T>): Promise<T> => {
      for (;;) {
        try {
          return await ask();
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (!AUTH_PENDING.test(message) || bridge !== b || Date.now() + AUTH_POLL_MS > deadline)
            throw e;
          if (!toldLogin) {
            toldLogin = true;
            notify(`Искрон: нужен вход — ${message}`, "warning");
          }
          await new Promise((r) => setTimeout(r, AUTH_POLL_MS));
        }
      }
    };
    const init = await untilAuthed(() =>
      b.request(
        "initialize",
        {
          protocolVersion: PROTOCOL,
          capabilities: {},
          clientInfo: { name: PI_CLIENT, version: "1" },
        },
        { timeoutMs: HANDSHAKE_MS },
      ),
    );
    if (bridge !== b) return b.stop(); // сессию сменили, пока мы ждали
    b.notify("notifications/initialized");

    // tools/list страничный: сервер вправе отдать курсор.
    const tools: any[] = [];
    let cursor: string | undefined;
    do {
      const page = await untilAuthed(() =>
        b.request("tools/list", cursor ? { cursor } : {}, {
          timeoutMs: HANDSHAKE_MS,
        }),
      );
      for (const t of page?.tools ?? []) tools.push(t);
      cursor = page?.nextCursor;
    } while (cursor);
    if (bridge !== b) return b.stop();

    // Регистрация тулов списка: первая — на старте, повторная — по слову моста
    // list_changed после выкатки сервера (#5406). pi снять тул не даёт: выброшенный
    // сервером остаётся до перезапуска, новые и изменённые регистрируются заново.
    function registerAll(list: any[]): void {
      for (const tool of list) {
        const name = String(tool.name);
        pi.registerTool({
          name,
          label: name,
          description: String(tool.description ?? ""),
          promptSnippet: snippet(String(tool.description ?? "")),
          parameters: toParameters(tool.inputSchema) as any,
          async execute(_toolCallId, params, signal, onUpdate, _c) {
            const live = bridge;
            if (!live) throw new Error(`${name}: мост не поднят в этой сессии`);
            const started = Date.now();
            onUpdate?.({ content: [{ type: "text", text: `Искрон: ${name}…` }], details: {} });
            const tick = setInterval(() => {
              onUpdate?.({
                content: [
                  {
                    type: "text",
                    text: `Искрон: ${name} — ещё жду, ${Math.round((Date.now() - started) / 1000)} с`,
                  },
                ],
                details: {},
              });
            }, TICK_MS);
            tick.unref?.();
            try {
              const result = await live.request(
                "tools/call",
                { name, arguments: params ?? {} },
                { signal }, // потолка нет: первый вызов может уйти в браузер к человеку
              );
              // Отказ тула сигналится броском — только он ставит isError.
              if (result?.isError) {
                const text = resultToContent(result)
                  .map((c) => (c.type === "text" ? c.text : "[image]"))
                  .join("\n");
                throw new Error(text || `${name}: отказ без текста`);
              }
              const content = resultToContent(result);
              return {
                content,
                details: { tool: name, structuredContent: result?.structuredContent },
              };
            } finally {
              clearInterval(tick);
            }
          },
        });
      }
    }

    async function relist(from: Bridge): Promise<void> {
      if (bridge !== from) return;
      try {
        const fresh: any[] = [];
        let next: string | undefined;
        do {
          const page = await from.request("tools/list", next ? { cursor: next } : {}, {
            timeoutMs: HANDSHAKE_MS,
          });
          for (const t of page?.tools ?? []) fresh.push(t);
          next = page?.nextCursor;
        } while (next);
        if (bridge !== from) return;
        registerAll(fresh);
        notify(`Искрон: сервер сменил тулы — в сессии зарегистрировано ${fresh.length}.`, "info");
      } catch (e) {
        notify(
          `Искрон: список тулов после смены на сервере не перечитан — ${(e as Error).message}`,
          "warning",
        );
      }
    }

    registerAll(tools);

    const server = init?.serverInfo;
    notify(
      `Искрон: мост поднят (${server?.name ?? "сервер"} ${server?.version ?? ""}), тулов в сессии: ${tools.length}${toldLogin ? " — вход состоялся" : ""}.`,
      "info",
    );
  }

  pi.on("session_start", async (_event, ctx) => {
    notify = ctx.hasUI ? (t, l) => ctx.ui.notify(t, l ?? "info") : () => {};
    canSpeak = Boolean(ctx.hasUI);
    bridge?.stop();
    bridge = null;

    const work = raise().catch((e: Error) => {
      notify(`Искрон: мост не поднялся — ${e.message}`, "error");
      bridge?.stop();
      bridge = null;
    });

    // Ждём ограниченно. Быстрый путь (токены на месте) укладывается в секунды и
    // тулы стоят до первого хода; долгий OAuth не держит сессию заложником —
    // тулы доедут регистрацией на ходу, о чём скажет notify.
    let done = false;
    void work.then(() => {
      done = true;
    });
    await Promise.race([
      work,
      new Promise<void>((r) => {
        const t = setTimeout(() => {
          if (!done) {
            notify(
              "Искрон: мост ещё поднимается — тулы iskron_* появятся, как только ответит.",
              "info",
            );
          }
          r();
        }, READY_WAIT_MS);
        t.unref?.();
      }),
    ]);
  });

  pi.on("session_shutdown", async () => {
    // Идемпотентно: pi зовёт это и на путях, где ничего не поднималось.
    bridge?.stop();
    bridge = null;
  });
}

/* eslint-enable @typescript-eslint/no-explicit-any */
