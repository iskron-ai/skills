// Клиент MCP по stdio к дочернему мосту и перевод его ответов в форму pi.
import { type ChildProcess, spawn } from "node:child_process";

/* eslint-disable @typescript-eslint/no-explicit-any -- JSON-RPC-полезная нагрузка приходит без схемы */

export type Content =
  { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/** Клиент MCP по stdio. Кадрирование — NDJSON в обе стороны, как у моста. */
export class Bridge {
  private proc: ChildProcess | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private tail: string[] = [];
  private dead: Error | null = null;
  private readonly bin: string;
  private readonly onLog: (line: string) => void;
  private readonly onNotification: (method: string, params: any) => void;

  constructor(
    bin: string,
    onLog: (line: string) => void,
    onNotification: (method: string, params: any) => void = () => {},
  ) {
    this.bin = bin;
    this.onLog = onLog;
    this.onNotification = onNotification;
  }

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
      if (typeof msg?.id !== "number") {
        // Уведомление без id — слово моста: кадры стояния приходят так.
        if (typeof msg?.method === "string") this.onNotification(msg.method, msg.params);
        continue;
      }
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

  request(
    method: string,
    params: unknown,
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<any> {
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
export function toParameters(inputSchema: any): any {
  const schema =
    inputSchema && typeof inputSchema === "object"
      ? { ...inputSchema }
      : { type: "object", properties: {} };
  delete schema.$schema; // не часть контракта параметров, а паспорт диалекта
  if (!schema.type) schema.type = "object";
  if (schema.type === "object" && !schema.properties) schema.properties = {};
  return schema;
}

/** Одна строка для секции «Available tools» системного промпта. */
export function snippet(description: string): string {
  const first = (description || "").split("\n").find((l) => l.trim()) ?? "";
  const cut = first.trim().split(/(?<=[.。!?])\s/)[0] ?? first.trim();
  return cut.length > 160 ? cut.slice(0, 157) + "…" : cut;
}

export function resultToContent(result: any): Content[] {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const out: Content[] = blocks.map((b: any): Content => {
    if (b?.type === "text") return { type: "text" as const, text: String(b.text ?? "") };
    if (b?.type === "image" && b.data) {
      return {
        type: "image" as const,
        data: String(b.data),
        mimeType: String(b.mimeType ?? "image/png"),
      };
    }
    return { type: "text" as const, text: JSON.stringify(b) };
  });
  if (out.length) return out;
  const structured = result?.structuredContent;
  return [
    { type: "text" as const, text: structured ? JSON.stringify(structured) : "(пустой ответ)" },
  ];
}

/* eslint-enable @typescript-eslint/no-explicit-any */
