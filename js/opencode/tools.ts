// Половина «тулы» — тулы Искрона через мост, каждый под своим именем,
// и МОСТ НА КАЖДУЮ СЕССИЮ (граф nks-dev: #4283).
//
// Плагин сам говорит с мостом по MCP stdio и регистрирует КАЖДЫЙ тул сервера
// через ctx.tool.transform под его собственным именем; чем плоха соседняя
// запись `mcp` и как она видна в каталоге — neighbour.ts.
//
// Сервер OpenCode держит много сессий, и каждая — отдельный агент со своим
// стоянием; мост же держит одно стояние и одну MCP-сессию к графу. Поэтому
// у каждой корневой сессии свой процесс моста: её connect держит её сокет, её
// register привязывает её MCP-сессию, её кадры приходят ей. Дочерняя сессия
// (субагент) читает мостом родителя, а встав своим вызовом — получает свой
// мост: стояние одно на мост, и её место иначе снимало бы родительское (#5154).
//
// Список тулов — состояние трансформа, а не карта, отданная раз при загрузке:
// setup входа не ждёт (тулы из прошлого списка сразу, служебный iskron_bridge
// всегда), а список с сервера приходит фоном и подменяется через
// ctx.tool.reload() — сколько бы ни длился вход человека.
import { Bridge, toParameters } from "../shared/bridge-client.ts";
import {
  AUTH_POLL_MS,
  authDir,
  buildsLine,
  findBridge,
  handshake,
  listTools,
  readCache,
  refreshToolList,
  sleep,
  textOf,
  writeCache,
} from "./bridge-io.ts";
import { createKeeper, type KeptSlot, takeLostMarker, WATCH_MS, writeLostMarker } from "./keep.ts";
import { warnOnNeighbour } from "./neighbour.ts";
import type { Context } from "./plugin.ts";
import { statusLines } from "./status.ts";

export type Say = (text: string, level: "info" | "warning" | "error") => void;

/**
 * Мост сессии, которая давно молчит и ничего не держит, отпускается. Инвариант:
 * IDLE_MS > WATCH_MS — сторож слуха (keep.ts) смотрит за стоявшим слотом чаще,
 * чем жнец его сжимает, иначе мост, потерявший место, ушёл бы прежде возврата.
 */
const IDLE_MS = Number(process.env.ISKRON_BRIDGE_IDLE_MS || 30 * 60_000);
if (IDLE_MS <= WATCH_MS)
  process.stderr.write(
    `[iskron/warning] ISKRON_BRIDGE_IDLE_MS (${IDLE_MS}) не длиннее такта сторожа слуха (${WATCH_MS}): слот может быть сжат прежде возврата места\n`,
  );
/** Шаг жнеца простоя; переменная — для проб. */
const REAP_MS = Number(process.env.ISKRON_BRIDGE_REAP_MS || 60_000);
/** Служебный тул плагина: состояние моста, когда тулов iskron_* ещё нет. */
export const STATUS_TOOL = "iskron_bridge";
/** Тул моста, которому плагин подставляет директорию сессии (cwd) для вывода имени. */
const STAND_TOOL = "iskron_stand";

/* eslint-disable @typescript-eslint/no-explicit-any -- ответы моста приходят без схемы */

/** Мост одной сессии. */
export interface Slot extends KeptSlot {
  /** Рукопожатие прошло — можно звать тулы. */
  ready: Promise<unknown>;
  /** Корневая сессия, которой принадлежит мост; null — ещё никому не отдан. */
  session: string | null;
  lastCall: number;
  /** Вызовов в полёте — мост посреди вызова жнецу не отдаётся. */
  busy: number;
  /** Мост остановлен самим плагином — его выход не потеря слуха. */
  ownStop: boolean;
}

/** Вызов, чей успех означает: сессия стоит (мост держит место либо привязан к нему). */
function standsBy(name: string, args: Record<string, unknown>): boolean {
  if (name === STAND_TOOL) return true;
  return name === "iskron_channel" && ["connect", "mint", "register"].includes(String(args.action));
}

const hhmm = (): string => new Date().toTimeString().slice(0, 5);

export interface ToolsHalf {
  /** Сессия умерла — её мост отпускается вместе со стоянием. */
  forget(session: string): void;
  stop(): void;
}

export async function setupTools(
  ctx: Context,
  say: Say,
  onChannel: (session: string | null, params: any, child?: boolean) => void,
  rootOf: (sessionID: string) => Promise<string>,
): Promise<ToolsHalf> {
  const found = findBridge();
  if (!found.path) {
    say(
      "Искрон: мост не найден — тулов iskron_* в этой сессии не будет. Искал: " +
        found.tried.join(", ") +
        ". Задай ISKRON_BRIDGE_PATH или поставь мост скиллом establish-mcp.",
      "error",
    );
    return { forget() {}, stop() {} };
  }
  const path = found.path;
  const builds = buildsLine(path, import.meta.url);

  const slots = new Map<string, Slot>();
  let spare: Slot | null = null;
  let stopped = false;

  // Человек в браузере: сказать один раз на вход. Вход кончился или мост
  // открыл новый (другая ссылка) — скажется снова.
  let loginPending = false;
  let loginUrl: string | null = null;
  // Вызов, ждущий рукопожатия, отпускается в миг, когда мост запросил вход:
  // человека внутри вызова не ждут, адрес уходит ответом.
  const loginWaiters = new Set<() => void>();
  /** Обещание входа и его снятие — вызов, кончившийся иначе, ждуна за собой не оставляет. */
  function loginStarted(): { promise: Promise<void>; cancel: () => void } {
    if (loginPending) return { promise: Promise.resolve(), cancel() {} };
    let waiter: () => void = () => {};
    const promise = new Promise<void>((r) => (waiter = r));
    loginWaiters.add(waiter);
    return { promise, cancel: () => loginWaiters.delete(waiter) };
  }
  function onLogin(url: string | null): void {
    for (const w of loginWaiters) w();
    loginWaiters.clear();
    if (loginPending && url === loginUrl) return;
    loginPending = true;
    loginUrl = url;
    say(
      `Искрон: нужен вход — ${url ? `открой ${url} и заверши его` : "заверши его в браузере"}; ` +
        "адрес локальный: с другой машины — ssh -L <порт>:127.0.0.1:<порт>, либо личный токен в ~/.iskron-bridge/token. " +
        "Тулы iskron_* поднимутся после входа сами.",
      "warning",
    );
  }
  function loginError(): Error {
    return new Error(
      `Искрон: нужен вход в граф — ${loginUrl ? `открой в браузере ${loginUrl}` : "заверши вход в браузере"} и повтори вызов. ` +
        "Адрес локальный для машины OpenCode: с другой — ssh -L <порт>:127.0.0.1:<порт>; " +
        "на безголовой машине положи личный токен в ~/.iskron-bridge/token (скилл establish-mcp).",
    );
  }

  function spawn(): Slot {
    const slot: Slot = {
      bridge: null as unknown as Bridge,
      ready: Promise.resolve(),
      session: null,
      holding: false,
      stood: false,
      dir: null,
      key: null,
      resume: null,
      lastCall: Date.now(),
      busy: 0,
      ownStop: false,
    };
    slot.bridge = new Bridge(
      path,
      (line) => say(`Искрон/мост: ${line}`, "info"),
      (method, params) => {
        if (method === "notifications/tools/list_changed") return void relist(slot.bridge); // #5406
        if (method !== "notifications/message" || params?.logger !== "iskron-channel") return;
        const kind = params?.data?.kind;
        // holding питается наблюдаемым событием — словом моста «держу» и hello,
        // а не attached локального сокета, которого у плагина нет (#5140).
        if (kind === "held" || kind === "attached" || params?.data?.frame?.type === "hello")
          keeper.stood(slot);
        if ((kind === "held" || kind === "released") && typeof params?.data?.key === "string")
          slot.key = params.data.key; // ключ места — точный адрес записи для возврата
        if (kind === "released" || kind === "dead" || kind === "evicted") slot.holding = false;
        onChannel(slot.session, params, !!slot.child);
      },
      (e) => {
        // Держащий мост вышел не по нашей воле — слух потерян, и это слово в
        // сессию, а не строка в лог, которого никто не читает (#5140).
        if (slot.ownStop || stopped || !slot.holding) return;
        slot.holding = false;
        onChannel(slot.session, {
          logger: "iskron-channel",
          data: {
            kind: "lost",
            text:
              `Искрон: слух потерян в ${hhmm()} — мост стояния вышел (${e.message}). ` +
              "Сторож слуха поднимет мост и вернёт место с диска; не ждёшь — iskron_stand.",
          },
        });
      },
    );
    slot.bridge.start();
    shake(slot);
    return slot;
  }

  const keeper = createKeeper({
    say,
    tell: (root, text, child) =>
      onChannel(root, { logger: "iskron-channel", data: { kind: "resumed", text } }, !!child),
    slotFor: (root, touch) => slotFor(root, touch),
    ready: readyFor,
    directoryOf,
  });
  // Прежний экземпляр остановили с держащим мостом: слово о том — в первую живую
  // сессию, ключи его мест — сторожу, чтобы возврат шёл по ключу, не по каталогу.
  const lost = takeLostMarker(authDir());
  let lostWord = lost?.text ?? null;
  if (lost) {
    say(lost.text, "warning");
    keeper.hint(lost.entries);
  }

  function shake(slot: Slot): void {
    slot.ready = handshake(slot.bridge, onLogin, () => {
      loginPending = false;
      loginUrl = null;
    });
    slot.ready.catch(() => {});
  }

  /** Рукопожатие слота; упавшее повторяется тут же, один раз. */
  async function readyFor(slot: Slot): Promise<void> {
    try {
      await slot.ready;
    } catch {
      shake(slot);
      await slot.ready;
    }
  }

  /**
   * Директория сессии — рабочая копия, над которой идёт ход: у SessionInfo
   * OpenCode 2 она в location.directory (@opencode/plugin 2.0.4). Нет её —
   * пусто, мост выведет из своего cwd.
   */
  async function directoryOf(sessionID: string): Promise<string | null> {
    try {
      const res: any = await ctx.session.get({ sessionID } as any);
      const dir = res?.location?.directory ?? res?.data?.location?.directory;
      return typeof dir === "string" && dir.trim() ? dir : null;
    } catch {
      return null;
    }
  }

  /**
   * Мост корневой сессии: первый раз — запасной с загрузки, дальше свой; умерший
   * — заменяется. touch=false — взгляд сторожа, не вызов: простой не освежается,
   * иначе слот под сторожем не сжался бы никогда.
   */
  async function slotFor(sessionID: string, touch = true): Promise<Slot> {
    const root = await rootOf(sessionID);
    // Дочерняя сессия, вставшая своим вызовом, ходит своим мостом (#5154);
    // чтение без стояния наследует мост корня.
    const own = root !== sessionID ? slots.get(sessionID) : undefined;
    if (own) {
      // Умерший детский мост заменяется своим же, не мостом корня: чтения и
      // записи ребёнка не уходят под привязку корня, сторож возвращает его место.
      const live = own.bridge.failure ? childSlot(sessionID) : own;
      if (touch) live.lastCall = Date.now();
      return live;
    }
    let slot = slots.get(root);
    let dead: Slot | undefined;
    if (slot?.bridge.failure) {
      dead = slot;
      slots.delete(root);
      slot = undefined;
    }
    if (!slot) {
      slot = spare ?? spawn();
      spare = null;
      slot.session = root;
      // Память умершего моста — каталог и ключ места — переходит к его замене:
      // возврат идёт по ключу, а не по одному каталогу.
      slot.dir = dead?.dir ?? slot.dir;
      slot.key = dead?.key ?? slot.key;
      slots.set(root, slot);
      if (lostWord) {
        onChannel(root, { logger: "iskron-channel", data: { kind: "lost", text: lostWord } });
        lostWord = null;
      }
      // Место прежнего экземпляра плагина (вытеснение каталога, перезапуск)
      // возвращается с диска по каталогу сессии — до первого вызова тула.
      const s = slot;
      s.resume = keeper.resume(s, root).finally(() => (s.resume = null));
    }
    if (touch) slot.lastCall = Date.now();
    return slot;
  }

  // Мост молчащей сессии без стояния не живёт вечно: opencode run плодит
  // сессии, а запас без сессии — каждая локация сервиса.
  const reaper = setInterval(() => {
    const now = Date.now();
    for (const [session, slot] of slots) {
      if (slot.holding || slot.busy > 0 || now - slot.lastCall < IDLE_MS) continue;
      slot.ownStop = true;
      slot.bridge.stop();
      slots.delete(session);
    }
    if (spare && !spare.holding && now - spare.lastCall >= IDLE_MS && state.serverSeen) {
      spare.ownStop = true;
      spare.bridge.stop();
      spare = null;
    }
  }, REAP_MS);
  reaper.unref?.();

  const state = {
    listed: readCache() ?? ([] as any[]),
    source: "из прошлого списка",
    serverSeen: false,
  };

  const relist = (b: Bridge | null) =>
    b &&
    refreshToolList(
      b,
      state,
      () => ctx.tool.reload(),
      say,
      () => !stopped,
    );
  const statusText = (): string =>
    statusLines(path, builds, { loginPending, loginUrl }, state, slots.size, spare ? 1 : 0);

  await ctx.tool.transform((editor) => {
    warnOnNeighbour(editor, say);
    editor.add({
      name: STATUS_TOOL,
      description:
        "Состояние моста Искрона в этой сессии OpenCode: выполнен ли вход, адрес авторизации, сколько тулов iskron_* поднято. " +
        "Зови, когда тулов iskron_* нет или они отвечают отказом входа.",
      input: { type: "object", properties: {}, additionalProperties: false } as any,
      async execute() {
        return { content: statusText() };
      },
    });
    for (const t of state.listed) {
      const name = String(t.name);
      editor.add({
        name,
        description: String(t.description ?? ""),
        // JSON Schema сервера без паспорта диалекта — той же срезкой, что у pi.
        input: toParameters(t.inputSchema),
        async execute(input, tool) {
          const slot = await slotFor(String(tool.sessionID));
          // Вызов в полёте — занятость: мост посреди вызова жнецу не отдаётся,
          // а простой считается от конца вызова, не от его начала.
          slot.busy++;
          try {
            return await callThrough(slot, name, input, String(tool.sessionID));
          } finally {
            slot.busy--;
            slot.lastCall = Date.now();
          }
        },
      });
    }
  });

  /**
   * Мост дочерней сессии для её собственного стояния — один на сессию: живой
   * возвращается, умерший заменяется с его памятью о месте; участок get→set
   * синхронен, и два стоячих вызова одной пачки берут один мост, не два.
   * Место с диска по каталогу ребёнку не возвращается (он встаёт сейчас);
   * возврат по имени внутри iskron_stand — как у всякого моста.
   */
  function childSlot(sessionID: string): Slot {
    const have = slots.get(sessionID);
    if (have && !have.bridge.failure) return have;
    const own = spawn();
    own.session = sessionID;
    own.child = true;
    own.dir = have?.dir ?? null;
    own.key = have?.key ?? null;
    slots.set(sessionID, own);
    // Замена умершего детского моста возвращает его место сразу, по ключу из
    // «held», а не ждёт такта сторожа: записи ребёнка в этом окне шли бы
    // безавторными. Без ключа возвращать нечем — ребёнок встанет заново.
    if (have?.stood && own.key)
      own.resume = keeper.resume(own, sessionID).finally(() => (own.resume = null));
    return own;
  }

  /** Рукопожатие слота под гонкой со входом: человека внутри вызова не ждут, адрес входа уходит ответом. */
  async function awaitReady(slot: Slot): Promise<void> {
    if (loginPending) throw loginError();
    const login = loginStarted();
    try {
      await Promise.race([
        readyFor(slot),
        login.promise.then(() => {
          throw loginError();
        }),
      ]);
    } finally {
      login.cancel();
    }
  }

  /** Один вызов тула через мост слота. */
  async function callThrough(
    slot: Slot,
    name: string,
    input: any,
    sessionID: string,
  ): Promise<{ content: string }> {
    await awaitReady(slot);
    if (slot.resume) await slot.resume; // место возвращается с диска — не занимать его дважды
    // Потолка нет: контекст execute в v2 сигнала отмены не несёт.
    const args: Record<string, unknown> = { ...(input ?? {}) };
    // Стояние — одно на мост: дочерняя сессия (субагент), встающая своим вызовом,
    // получает свой мост, а не мост корня, — иначе её место снимало бы
    // родительское с сокета, а её register переписывал бы привязку корня (#5154).
    if (standsBy(name, args) && slot.session !== sessionID) {
      slot = childSlot(sessionID);
      await awaitReady(slot); // свежий детский мост может запросить вход — та же гонка, что у корня
    }
    // Мост бежит из cwd сервера OpenCode, не из рабочей копии сессии:
    // репо для имени стояния он выводит из директории сессии (r5 #5108) —
    // той, чей это мост: корня для корня, дочерней для её собственного.
    if (name === STAND_TOOL && !args.cwd) {
      const dir = (slot.dir ??= await directoryOf(slot.session ?? sessionID));
      if (dir) args.cwd = dir;
    }
    const result = await slot.bridge.request("tools/call", { name, arguments: args });
    // Отказ тула сигналится броском — так OpenCode показывает его отказом.
    if (result?.isError) throw new Error(textOf(result) || `${name}: отказ без текста`);
    if (standsBy(name, args)) keeper.stood(slot); // ответ тула — наблюдаемое событие держания
    return { content: textOf(result) };
  }
  if (state.listed.length)
    say(`Искрон: тулов из прошлого списка: ${state.listed.length}; сверю с сервером.`, "info");

  // Первый мост — ради списка тулов, фоном и без потолка: истёкшее ожидание
  // входа или умерший мост — новое рукопожатие или новый мост, пока плагин жив.
  spare = spawn();
  let first = spare;
  void (async () => {
    for (;;) {
      if (stopped) return;
      try {
        await first.ready;
        const list = await listTools(first.bridge);
        state.serverSeen = true;
        const same = JSON.stringify(list) === JSON.stringify(state.listed);
        state.listed = list;
        state.source = "с сервера";
        writeCache(list);
        if (!same) await ctx.tool.reload();
        say(`Искрон: мост поднят, тулов в сессии: ${list.length} (с сервера).`, "info");
        return;
      } catch (e) {
        if (stopped) return;
        if (first.bridge.failure) {
          // Мост списка умер — или был отдан сессии и отпущен ею (тогда молча):
          // список берёт новый запас.
          if (first.session === null)
            say(`Искрон: мост умер (${(e as Error).message}) — поднимаю новый.`, "warning");
          if (spare === first) spare = null;
          first = spare ?? spawn();
          spare = first;
        } else {
          shake(first);
        }
        await sleep(AUTH_POLL_MS);
      }
    }
  })();

  return {
    forget(session) {
      keeper.forget(session);
      const slot = slots.get(session);
      if (!slot) return;
      slots.delete(session);
      slot.ownStop = true;
      slot.bridge.stop(); // свёртка моста отпускает стояние: ключ, сокет, занятость
    },
    stop() {
      stopped = true;
      clearInterval(reaper);
      keeper.stop();
      // Остановка с держащими мостами — на диск: следующий экземпляр скажет о потере.
      writeLostMarker(authDir(), slots.values());
      if (spare) spare.ownStop = true;
      spare?.bridge.stop();
      spare = null;
      for (const slot of slots.values()) {
        slot.ownStop = true;
        slot.bridge.stop();
      }
      slots.clear();
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
