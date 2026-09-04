// Тулы Искрона внутри сессии pi: расширение само говорит с `iskron-bridge` по MCP
// stdio и регистрирует КАЖДЫЙ тул сервера под его собственным именем.
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
//
// Фабрика не поднимает моста: pi зовёт её и в вызовах, где сессии не будет
// вовсе. Процесс живёт от session_start до session_shutdown.
import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Сколько ждать поднятия моста, ПРЕЖДЕ чем отпустить старт сессии. */
const READY_WAIT_MS = Number(process.env.ISKRON_MCP_READY_WAIT_MS || 20000);
/** Потолок самого рукопожатия. Щедрый: первый запуск уводит человека в браузер. */
const HANDSHAKE_MS = Number(process.env.ISKRON_MCP_HANDSHAKE_MS || 600000);
/** Такт «я ещё жду» у долгого вызова. */
const TICK_MS = 15000;

const PROTOCOL = "2025-06-18";

type Notify = (text: string, level?: "info" | "warning" | "error") => void;

/** Путь к мосту выводится, не зашивается: расширение и мост едут одним репозиторием. */
function findBridge(): { path: string; tried: string[] } | { path: null; tried: string[] } {
  const tried: string[] = [];
  const push = (p: string | null | undefined) => {
    if (!p) return;
    tried.push(p);
  };
  push(process.env.ISKRON_BRIDGE_PATH?.trim() ? resolve(process.env.ISKRON_BRIDGE_PATH.trim()) : null);
  push(join(homedir(), ".iskron-bridge", "iskron-bridge.mjs"));
  try {
    // pi install git:… кладёт расширение рядом со скиллами того же репозитория.
    const here = dirname(fileURLToPath(import.meta.url));
    push(resolve(here, "..", "skills", "establish-mcp", "scripts", "iskron-bridge.mjs"));
  } catch {
    /* загрузчик не дал собственного пути — остаются первые два кандидата */
  }
  for (const candidate of tried) {
    try {
      accessSync(candidate, constants.R_OK);
      return { path: candidate, tried };
    } catch {
      /* следующий кандидат */
    }
  }
  return { path: null, tried };
}

/** Клиент MCP по stdio. Кадрирование — NDJSON в обе стороны, как у моста. */
class Bridge {
  private proc: ChildProcess | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private tail: string[] = [];
  private dead: Error | null = null;

  constructor(
    private readonly bin: string,
    private readonly onLog: (line: string) => void,
  ) {}

  start(): void {
    const proc = spawn(process.execPath, [this.bin], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc = proc;
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => this.feed(chunk));
    proc.stderr?.setEncoding("utf8");
    // Слово моста — единственное окно в затянувшийся OAuth: его видно, значит
    // это не зависание.
    let errBuf = "";
    proc.stderr?.on("data", (chunk: string) => {
      errBuf += chunk;
      const lines = errBuf.split("\n");
      errBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        this.tail.push(line);
        if (this.tail.length > 20) this.tail.shift();
        this.onLog(line);
      }
    });
    proc.on("error", (e) => this.die(new Error(`мост не запустился: ${e.message}`)));
    proc.on("exit", (code, signal) =>
      this.die(new Error(`мост вышел (code=${code}, signal=${signal})${this.why()}`)),
    );
  }

  private why(): string {
    return this.tail.length ? `; последнее от моста: ${this.tail.slice(-3).join(" | ")}` : "";
  }

  private die(e: Error): void {
    if (this.dead) return;
    this.dead = e;
    for (const [, p] of this.pending) p.reject(e);
    this.pending.clear();
  }

  private feed(chunk: string): void {
    this.buf += chunk;
    // Только LF: делить обобщённым читателем строк нельзя, U+2028/U+2029 законны
    // внутри JSON-строки.
    const lines = this.buf.split("\n");
    this.buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.replace(/\r$/, "").trim();
      if (!trimmed) continue;
      let msg: any;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        continue; // не наш кадр — мост говорит по stderr, а не сюда
      }
      if (typeof msg?.id !== "number") continue; // уведомления сервера здесь не нужны
      const waiter = this.pending.get(msg.id);
      if (!waiter) continue;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else waiter.resolve(msg.result);
    }
  }

  notify(method: string, params?: unknown): void {
    if (this.dead || !this.proc?.stdin?.writable) return;
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  request(method: string, params: unknown, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<any> {
    if (this.dead) return Promise.reject(this.dead);
    const id = this.nextId++;
    return new Promise((res, rej) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const settle = (fn: (v: any) => void) => (v: any) => {
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        fn(v);
      };
      const resolve = settle(res);
      const reject = settle(rej as (v: any) => void);
      function onAbort() {
        reject(new Error("вызов отменён"));
      }
      this.pending.set(id, { resolve, reject });
      if (opts.signal) {
        if (opts.signal.aborted) return onAbort();
        opts.signal.addEventListener("abort", onAbort, { once: true });
      }
      if (opts.timeoutMs) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`${method}: нет ответа за ${opts.timeoutMs} мс${this.why()}`));
        }, opts.timeoutMs);
        timer.unref?.();
      }
      if (!this.proc?.stdin?.writable) return reject(new Error("мост не принимает запись"));
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  stop(): void {
    this.die(new Error("сессия закрыта"));
    const proc = this.proc;
    this.proc = null;
    if (!proc || proc.killed || proc.exitCode !== null) return;
    try {
      proc.stdin?.end();
      proc.kill("SIGTERM");
      // Мост держится до конца висящего OAuth — не даём ему пережить сессию.
      const hard = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* уже умер */
        }
      }, 2000);
      hard.unref?.();
      proc.on("exit", () => clearTimeout(hard));
    } catch {
      /* закрывать нечего */
    }
  }
}

/** Схема тула для pi. Конверсии нет — только отбрасывается мета-ключ. */
function toParameters(inputSchema: any): any {
  const schema =
    inputSchema && typeof inputSchema === "object" ? { ...inputSchema } : { type: "object", properties: {} };
  delete schema.$schema; // не часть контракта параметров, а паспорт диалекта
  if (!schema.type) schema.type = "object";
  if (schema.type === "object" && !schema.properties) schema.properties = {};
  return schema;
}

/** Одна строка для секции «Available tools» системного промпта. */
function snippet(description: string): string {
  const first = (description || "").split("\n").find((l) => l.trim()) ?? "";
  const cut = first.trim().split(/(?<=[.。!?])\s/)[0] ?? first.trim();
  return cut.length > 160 ? cut.slice(0, 157) + "…" : cut;
}

function resultToContent(result: any): { type: "text" | "image"; [k: string]: any }[] {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const out = blocks.map((b: any) => {
    if (b?.type === "text") return { type: "text" as const, text: String(b.text ?? "") };
    if (b?.type === "image" && b.data) {
      return { type: "image" as const, data: b.data, mimeType: b.mimeType ?? "image/png" };
    }
    return { type: "text" as const, text: JSON.stringify(b) };
  });
  if (out.length) return out;
  const structured = result?.structuredContent;
  return [{ type: "text" as const, text: structured ? JSON.stringify(structured) : "(пустой ответ)" }];
}

export default function (pi: ExtensionAPI) {
  let bridge: Bridge | null = null;
  let notify: Notify = () => {};

  async function raise(): Promise<void> {
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

    const b = new Bridge(found.path, (line) => notify(`Искрон/мост: ${line}`, "info"));
    bridge = b;
    b.start();

    const init = await b.request(
      "initialize",
      {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: "pi-iskron-mcp", version: "1" },
      },
      { timeoutMs: HANDSHAKE_MS },
    );
    if (bridge !== b) return b.stop(); // сессию сменили, пока мы ждали
    b.notify("notifications/initialized");

    // tools/list страничный: сервер вправе отдать курсор.
    const tools: any[] = [];
    let cursor: string | undefined;
    do {
      const page = await b.request("tools/list", cursor ? { cursor } : {}, { timeoutMs: HANDSHAKE_MS });
      for (const t of page?.tools ?? []) tools.push(t);
      cursor = page?.nextCursor;
    } while (cursor);
    if (bridge !== b) return b.stop();

    for (const tool of tools) {
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
            return { content: resultToContent(result), details: { tool: name, structuredContent: result?.structuredContent } };
          } finally {
            clearInterval(tick);
          }
        },
      });
    }

    const server = init?.serverInfo;
    notify(
      `Искрон: мост поднят (${server?.name ?? "сервер"} ${server?.version ?? ""}), тулов в сессии: ${tools.length}.`,
      "info",
    );
  }

  pi.on("session_start", async (_event, ctx) => {
    notify = ctx.hasUI ? (t, l) => ctx.ui.notify(t, l ?? "info") : () => {};
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
          if (!done) notify("Искрон: мост ещё поднимается — тулы iskron_* появятся, как только ответит.", "info");
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
