// Дверь Искрона в сессию pi — ОДНО расширение, две независимые половины.
//
//   • тулы     — расширение поднимает `iskron-bridge` дочерним процессом и
//                регистрирует каждый тул сервера под его собственным именем;
//   • канал    — расширение само держит сокет живого канала и вкладывает
//                пришедший кадр в идущий ход.
//
// Половины связаны одним волоском, и он же — причина, по которой файл один.
// `connect` не делают не для себя: он привязывает к занятому месту вызывающую
// СЕССИЮ, поэтому место занимает тот, кто будет его держать, изнутри себя.
// Значит адрес сокета не должен покидать сессию вовсе — ни переменной, ни
// файлом, ни из рук в руки. Он и не покидает: половина «тулы» проксирует
// каждый вызов `iskron_channel` и видит ответ, в котором сокет показан
// единожды; увиденное она подаёт половине «канал», и та начинает слушать. От
// человека не требуется ничего, от агента — только занять стояние своими же
// тулами.
//
// Почему один файл, а не два. Каталог `extensions/` — конвенционный: pi считает
// отдельным расширением КАЖДЫЙ .ts/.js в нём (см. `collectAutoExtensionEntries`
// в package-manager.js — обход на один уровень, без рекурсии). Значит «одно
// расширение» здесь буквально значит «один файл»; всякий сосед рядом стал бы
// вторым расширением, а подкаталог с `index.ts` — тоже вторым. Половины при
// этом остаются независимыми: каждая вешает СВОИ обработчики, и pi изолирует
// каждый обработчик своим try/catch, так что отказ одной не гасит другую и не
// роняет сессию.
//
// Фабрика не поднимает ничего живого: pi зовёт её и в вызовах, где сессии не
// будет вовсе. Сокет, мост, таймеры — только от session_start до
// session_shutdown, и снятие идемпотентно.
import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, chmodSync, constants, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Notify = (text: string, level?: "info" | "warning" | "error") => void;

// ═══════════════════════════════════════════════════════════════════════════
// Половина I — тулы Искрона через мост
// ═══════════════════════════════════════════════════════════════════════════
//
// Расширение само говорит с `iskron-bridge` по MCP stdio и регистрирует КАЖДЫЙ
// тул сервера под его собственным именем.
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

/** Сколько ждать поднятия моста, ПРЕЖДЕ чем отпустить старт сессии. */
const READY_WAIT_MS = Number(process.env.ISKRON_MCP_READY_WAIT_MS || 20000);
/** Потолок самого рукопожатия. Щедрый: первый запуск уводит человека в браузер. */
const HANDSHAKE_MS = Number(process.env.ISKRON_MCP_HANDSHAKE_MS || 600000);
/** Такт «я ещё жду» у долгого вызова. */
const TICK_MS = 15000;

const PROTOCOL = "2025-06-18";

/** Версия моста объявлена константой в его тексте — читаем строкой, без запуска. */
function bridgeVersion(path: string): string | null {
  try {
    const m = /^const VERSION = "([^"]+)"/m.exec(readFileSync(path, "utf8"));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Строгое сравнение X.Y.Z: 1 если a новее b, -1 если старее, 0 если равны или нечитаемо. */
function newer(a: string, b: string): number {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  if (pa.length !== 3 || pb.length !== 3 || [...pa, ...pb].some((n) => !Number.isInteger(n))) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  return 0;
}

/**
 * Обновление поставки НЕ обновляло мост: расширение предпочитает домашнюю копию,
 * потому что рядом с ней лежит грант, — и делатель работал старым мостом, считая,
 * что обновился. Наблюдено на штатной установке сразу после релиза: код 6.0.0
 * поднял мост 5.0.0. Дорого это тем, что мост штампует свою сборку в каждую
 * ошибку и в лог гранта: полевой репорт с новой поставки приходил бы со старым
 * числом, и расхождение читали бы как ошибку репортёра.
 *
 * Грант при этом НЕ в файле моста, а рядом с ним отдельными файлами, — поэтому
 * заменить сам скрипт безопасно, вход не теряется.
 *
 * Две ограды. Только СТРОГО новее: иначе старая поставка на другой машине молча
 * откатила бы мост назад. И только вслух: чинить не запрещено, чинить молча —
 * запрещено, иначе это то же тихое расхождение, только в нашу пользу.
 */
function refreshHomeBridge(notify: Notify): void {
  // Путь задан человеком руками — его выбор старше нашей заботы, не трогаем ничего.
  if (process.env.ISKRON_BRIDGE_PATH?.trim()) return;
  let packaged: string;
  try {
    packaged = resolve(dirname(fileURLToPath(import.meta.url)), "..", "skills", "establish-mcp", "scripts", "iskron-bridge.mjs");
  } catch {
    return; // загрузчик не дал собственного пути — сравнивать не с чем
  }
  const home = join(homedir(), ".iskron-bridge", "iskron-bridge.mjs");
  const vPackaged = bridgeVersion(packaged), vHome = bridgeVersion(home);
  if (!vPackaged || !vHome) return; // домашней копии ещё нет или версия нечитаема — это дело establish-mcp
  const cmp = newer(vPackaged, vHome);
  if (cmp <= 0) {
    // Домашняя новее: её мог положить человек руками или другая поставка.
    // Откатывать молча нельзя, и не молча тоже — но и промолчать значит оставить его в неведении.
    if (cmp < 0) notify(`Искрон: дома мост ${vHome}, в поставке ${vPackaged} — домашний новее, не трогаю.`, "warning");
    return;
  }
  try {
    const tmp = home + ".new";
    writeFileSync(tmp, readFileSync(packaged));
    chmodSync(tmp, 0o755);
    renameSync(tmp, home); // атомарно: сессия рядом не увидит полуфайла
    notify(`Искрон: мост дома обновлён ${vHome} → ${vPackaged}. Грант не тронут, он лежит рядом отдельными файлами.`, "info");
  } catch (e) {
    notify(`Искрон: мост дома ${vHome}, в поставке ${vPackaged}, обновить не вышло (${(e as Error).message}). Работаю старым.`, "warning");
  }
}

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
  // Поля объявлены и присвоены отдельно, а не параметрами конструктора: сокра-
  // щение TS `constructor(private bin: string)` — единственная конструкция в
  // этом файле, которую нельзя СТЕРЕТЬ, её надо переписать. Node умеет только
  // стирание (`--experimental-strip-types`; `--experimental-transform-types`
  // из него убран), и на сокращении он бросает ещё до первой строки тела.
  // Развёрнутая форма ничего не меняет в поведении и делает файл грузимым
  // самой платформой — тем, что его и проверяет (tests/extension.test.mjs).
  private readonly bin: string;
  private readonly onLog: (line: string) => void;

  constructor(bin: string, onLog: (line: string) => void) {
    this.bin = bin;
    this.onLog = onLog;
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

/**
 * Достать адрес сокета из ответа `iskron_channel` и подать его слушателю.
 * Форму адреса не пересказываем дальше необходимого: берём первое, что
 * выглядит адресом сокета, и отдаём — судит о нём принимающая сторона.
 */
function harvestSocket(content: { type: string; [k: string]: any }[], offer: (url: string) => void): void {
  const text = content.map((c) => (c.type === "text" ? String(c.text ?? "") : "")).join("\n");
  const found = /wss?:\/\/[^\s"'`<>)\]]+/.exec(text)?.[0];
  if (!found) return;
  offer(found.replace(/[.,;:!?»"')\]]+$/, ""));
}

/**
 * Половина «тулы»: свои обработчики, своё состояние, свой отказ.
 * `offerSocket` — дверь половины «канал»: сюда уходит адрес, увиденный в ответе
 * `iskron_channel`. Это единственный путь сокета к слушателю, и он не выходит
 * за границу сессии.
 */
function setupBridge(pi: ExtensionAPI, offerSocket: (url: string) => void): void {
  let bridge: Bridge | null = null;
  let notify: Notify = () => {};

  async function raise(): Promise<void> {
    // Прежде поиска: если поставка привезла мост новее домашнего — обновить, вслух.
    // Порядок несущий: обновляем ДО подъёма, иначе новый мост побежал бы только
    // со следующей сессии, а эта осталась бы на старом, уже сказав, что обновилась.
    refreshHomeBridge(notify);
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
        clientInfo: { name: "pi-iskron", version: "1" },
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
            const content = resultToContent(result);
            // Сокет показывают ОДИН раз — в ответе на connect/mint. Перехват
            // здесь и есть то, ради чего половины живут одним файлом: адрес
            // уходит слушателю, не покидая сессии.
            if (name === "iskron_channel") harvestSocket(content, offerSocket);
            return { content, details: { tool: name, structuredContent: result?.structuredContent } };
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

// ═══════════════════════════════════════════════════════════════════════════
// Половина II — сокет живого канала
// ═══════════════════════════════════════════════════════════════════════════
//
// В Claude Code сокет держит отдельный процесс под Monitor, и кадр доходит до
// делателя строкой-событием. У pi есть то, чего там нет: расширение может само
// вложить пришедший кадр в идущий ход и поднять ход у простаивающего агента —
// `pi.sendMessage(..., { triggerTurn: true })`. Поэтому здесь сторож не отдельный
// процесс, а часть сессии, и посредник между сокетом и делателем не нужен.
//
// Дисциплина обрывов, коды мёртвого токена и публикация занятости перенесены из
// skills/standing/references/watchdog.mjs — они выведены полем, а не выдуманы
// здесь; боевые заметки к ним лежат в skills/standing/references/channel.md.
//
// Штатный путь адреса сюда — перехват из ответа `iskron_channel` половиной
// «тулы» (см. `offerSocket` там же): сокет так и не покидает сессию. Окружение
// — запасной путь для отладки, и только: адрес сокета секрет, а командная
// строка его не прячет (ps печатает и аргумент, и присваивание перед
// командой), поэтому в отладке он кладётся в файл с правами 0600, путь к
// которому назван переменной.

const DEAD_TOKEN = [4000, 4001, 4002];
const ROLLOUT = 4003;

function socketAddress(): string | null {
  const direct = process.env.ISKRON_CHANNEL_SOCKET?.trim();
  if (direct) return direct;
  const file = process.env.ISKRON_CHANNEL_SOCKET_FILE?.trim();
  if (!file) return null;
  try {
    return readFileSync(file, "utf8").trim() || null;
  } catch {
    return null; // файла ещё нет — это «не сказали», а не поломка
  }
}

function frameToText(frame: any, raw: string): string {
  if (!frame) return `Кадр канала Искрона:\n${raw}`;
  const from = frame.provenance?.from_standing || frame.provenance?.from_karta_seq;
  const head = from ? `Кадр канала Искрона от ${from}` : "Кадр канала Искрона";
  const body = typeof frame.body === "string" ? frame.body : raw;
  // Провенанс несут отдельной строкой: кто говорит, читается из происхождения
  // кадра, никогда из тела — телу любой держатель адреса придаст любой вид.
  return `${head}:\n\n${body}`;
}

async function serviceUp(url: string): Promise<{ version?: string } | null> {
  const version =
    new URL(url).origin.replace(/^wss:/, "https:").replace(/^ws:/, "http:") + "/api/version";
  return fetch(version, { signal: AbortSignal.timeout(5000) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

/**
 * Половина «канал»: свои обработчики, своё состояние, свой отказ.
 * Возвращает дверь, которой половина «тулы» подаёт сюда увиденный адрес сокета.
 */
function setupChannel(pi: ExtensionAPI): (url: string) => void {
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sayTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let fastDrops = 0;
  let ctxRef: any = null;
  let current: string | null = null;
  // Поколение: всё, что открыл прошлый адрес, перестаёт быть нашим в тот миг,
  // когда пришёл новый. Без этого закрытие старого сокета читается обрывом и
  // уводит переподключение на адрес, которого уже нет.
  let gen = 0;

  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;
    stopped = false;
    const url = socketAddress();
    if (!url) {
      // Места ещё нет — и это НЕ отказ. Занять его может только тот, кто будет
      // его держать, а держит его эта самая сессия: агент зовёт connect (и
      // следом register) своими тулами, а слушание включается само.
      if (ctx.hasUI) {
        ctx.ui.notify(
          'Искрон: места ещё нет. Займи стояние сам — iskron_channel(action="connect"), сразу за ним register тем же именем: слушание включится без отдельного действия.',
          "info",
        );
      }
      return;
    }
    hold(url); // запасной путь через окружение — отладочный
  });

  /** Взять этот адрес и слушать его, чем бы ни был занят прежний. */
  function hold(url: string) {
    if (url === current && socket && (socket.readyState === 0 || socket.readyState === 1)) return;
    current = url;
    stopped = false;
    fastDrops = 0;
    gen++; // прежнее поколение с этой строки уже не наше
    if (timer) clearTimeout(timer);
    if (sayTimer) clearInterval(sayTimer);
    timer = sayTimer = null;
    try {
      socket?.close(1000, "новый сокет");
    } catch {
      /* закрывать нечего */
    }
    socket = null;
    open(url, ctxRef);
    startSaying(url, ctxRef);
    if (ctxRef?.hasUI) ctxRef.ui.setStatus?.("iskron", "Искрон: канал прицепляется");
  }

  pi.on("session_shutdown", async () => {
    // Идемпотентно: pi зовёт это и на путях, где ничего не поднималось.
    stopped = true;
    gen++;
    current = null;
    if (timer) clearTimeout(timer);
    if (sayTimer) clearInterval(sayTimer);
    timer = sayTimer = null;
    try {
      socket?.close(1000, "session shutdown");
    } catch {
      /* закрывать нечего */
    }
    socket = null;
  });

  function open(url: string, ctx: any) {
    if (stopped) return;
    const myGen = gen;
    const startedAt = Date.now(); // от конструкции, НЕ в onopen — см. channel.md
    const ws = new WebSocket(url);
    socket = ws;
    let gone = false; // обрыв разбирается один раз, чем бы он ни пришёл

    ws.addEventListener("message", (e: MessageEvent) => {
      const body = typeof e.data === "string" ? e.data : "[двоичный кадр]";
      let frame: any = null;
      try {
        frame = JSON.parse(body);
      } catch {
        /* неJSON — донесём как есть */
      }
      // Служебные кадры не будят: hello доказывает, что сокет держат, и только.
      if (frame?.type === "hello") {
        // setStatus — пара (ключ, текст); один аргумент кладёт строку в ключ
        // и оставляет её без текста, то есть невидимой.
        if (ctx.hasUI) ctx.ui.setStatus?.("iskron", "Искрон: канал слушает");
        return;
      }
      if (frame?.type === "status") return;

      // Вот ради чего всё: кадр входит в идущий ход, а простаивающего агента
      // поднимает. Это и есть то, чего у сторожа-процесса быть не может.
      pi.sendMessage(
        {
          customType: "iskron-channel",
          content: frameToText(frame, body),
          display: true,
          details: frame ?? { raw: body },
        },
        { triggerTurn: true, deliverAs: "steer" },
      );
    });

    // Обрыв на самом апгрейде даёт на части рантаймов ТОЛЬКО error: close не
    // приходит вовсе. Отсрочка оставляет close шанс назвать свой код — коды
    // мёртвого токена приходят именно им.
    ws.addEventListener("error", () => setTimeout(() => dropped(1006, url, ctx), 500));
    ws.addEventListener("close", (e: CloseEvent) => dropped(e.code, url, ctx));

    async function dropped(code: number, u: string, c: any) {
      if (gone || stopped || myGen !== gen) return;
      gone = true;

      if (DEAD_TOKEN.includes(code)) {
        // Процессу здесь выйти некуда, поэтому громкость — это сказать делателю
        // так, чтобы он это увидел в ходе, а не в логе, которого никто не читает.
        loud(
          c,
          `Искрон: канал закрыт кодом ${code} — токен мёртв. Зови iskron_channel(action="connect")` +
            (code === 4001 ? ' или action="mint"' : "") +
            ", затем register тем же именем: новый сокет расширение возьмёт из ответа само, перезапуск не нужен.",
        );
        return;
      }

      fastDrops = Date.now() - startedAt < 5000 ? fastDrops + 1 : 0;
      if (fastDrops >= 3) {
        const up = await serviceUp(u);
        if (up) {
          loud(c, `Искрон: обрывы, а служба отвечает (${up.version}) — спроси о токене.`);
          return;
        }
        fastDrops = 1; // простой не должен перерасти в вопрос о токене
      }
      timer = setTimeout(() => open(u, c), code === ROLLOUT ? 3000 : 2000);
    }
  }

  function loud(ctx: any, text: string) {
    stopped = true;
    if (ctx?.hasUI) ctx.ui.notify(text, "error");
    pi.sendMessage(
      { customType: "iskron-channel", content: text, display: true, details: { fatal: true } },
      { triggerTurn: true, deliverAs: "steer" },
    );
  }

  // ── Слово делателя наружу: строка занятости ───────────────────────────────
  // Строку удостоверяет слушающий секрет, а он здесь. Делатель пишет ТЕКСТ в
  // файл, публикует расширение. Опрос, а не наблюдение: файла может ещё не быть,
  // а наблюдатель за несуществующим путём бросает.
  function startSaying(url: string, _ctx: any) {
    const sayFile = process.env.ISKRON_CHANNEL_SAY;
    if (!sayFile) return; // без переменной половина не включается
    const statusUrl =
      process.env.ISKRON_CHANNEL_STATUS ||
      url.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace("/channel/ws/", "/channel/status/");
    let said: string | null = null;
    sayTimer = setInterval(async () => {
      let text: string;
      try {
        text = readFileSync(sayFile, "utf8").trim();
      } catch {
        return; // ещё не написали — не о чем говорить
      }
      if (text === said) return; // публикуют смену занятия, а не такт
      const res = await fetch(statusUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);
      // Пустая строка — СЛОВО: ею занятость снимают.
      if (res?.ok) said = text;
      else if (res && res.status >= 400 && res.status < 500) said = text; // повтор той же ничего не изменит
    }, 1000);
    sayTimer.unref?.();
  }

  // Дверь наружу. Половина «тулы» подаёт сюда всё, что увидела; здесь решают,
  // адрес ли это и нужно ли что-то менять.
  return (url: string) => {
    const u = url?.trim();
    if (!u) return;
    // wss — то, чем говорит служба. Голый ws пускаем только на loopback: это
    // отладка и проба, а не секрет, идущий по проводу открытым.
    const loopback = /^ws:\/\/(127\.0\.0\.1|\[?::1\]?|localhost)(:|\/)/.test(u);
    if (!u.startsWith("wss://") && !loopback) return;
    hold(u);
  };
}

// ═══════════════════════════════════════════════════════════════════════════

export default function (pi: ExtensionAPI) {
  // Половины ставятся порознь и каждая под своим try: сорвавшаяся регистрация
  // одной не должна унести с собой другую — и не должна унести сессию.
  const broken: string[] = [];

  // Сообщаем о сорвавшейся постановке в самой сессии, а не в лог: в rpc-режиме
  // stdout занят протоколом, и напечатанное туда было бы порчей, а не словом.
  pi.on("session_start", async (_event, ctx) => {
    if (!broken.length || !ctx.hasUI) return;
    ctx.ui.notify(`Искрон: не встало — ${broken.join("; ")}`, "error");
  });

  // Канал ставится первым: он отдаёт дверь, которой половина «тулы» подаёт ему
  // увиденный адрес сокета. Сорвись он — дверь остаётся заглушкой, и половина
  // «тулы» встаёт как ни в чём не бывало; обратное тоже верно.
  let offerSocket: (url: string) => void = () => {};
  try {
    offerSocket = setupChannel(pi);
  } catch (e) {
    broken.push(`канал: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    setupBridge(pi, (url) => offerSocket(url));
  } catch (e) {
    broken.push(`тулы: ${e instanceof Error ? e.message : String(e)}`);
  }
}
