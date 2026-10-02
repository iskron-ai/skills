// Половина «тулы» — тулы Искрона через мост, каждый под своим именем,
// и МОСТ НА КАЖДУЮ СЕССИЮ (граф nks-dev: #4283).
//
// Плагин сам говорит с мостом по MCP stdio и регистрирует КАЖДЫЙ тул сервера
// через ctx.tool.transform под его собственным именем. Нативная запись `mcp`
// в конфиге OpenCode для этого не годится: тулы чужого сервера OpenCode именует
// <запись>.<тул> — наблюдено на 2.0.9, iskron.iskron_orient, — и каждая фраза
// скилла, зовущая iskron_orient, стала бы ложной.
//
// Сервер OpenCode держит много сессий, и каждая — отдельный агент со своим
// стоянием; мост же держит одно стояние и одну MCP-сессию к графу. Поэтому
// у каждой корневой сессии свой процесс моста: её connect держит её сокет, её
// register привязывает её MCP-сессию, её кадры приходят ей. Дочерняя сессия
// (субагент) читает мостом родителя, а встав своим вызовом — получает свой
// мост: в графе место одно на мост, и её место иначе снимало бы родительское (#5154).
//
// Список тулов — состояние трансформа, а не карта, отданная раз при загрузке:
// setup входа не ждёт (тулы из прошлого списка сразу, служебный iskron_bridge
// всегда), а список с сервера приходит фоном и подменяется через
// ctx.tool.reload() — сколько бы ни длился вход человека.
import { Bridge, toParameters } from "../shared/bridge-client.ts";
import {
  authDir,
  buildsLine,
  findBridge,
  handshake,
  listTools,
  readCache,
  refreshToolList,
  retryPause,
  sleep,
  textOf,
  writeCache,
} from "./bridge-io.ts";
import { createChildren } from "./children.ts";
import { hostEnvOf, sessionDirectory } from "./host.ts";
import { createKeeper, type KeptSlot, takeLostMarker, WATCH_MS, writeLostMarker } from "./keep.ts";
import { createLauncher } from "./launch.ts";
import { createLeads } from "./leads.ts";
import { leadDoors } from "./leadwords.ts";
import { createLogin } from "./login.ts";
import type { Context } from "./plugin.ts";
import { createRunEnds } from "./runends.ts";
import { asSatellite, heldPlace, type SatelliteSlot, STAND_TOOL, standsBy } from "./satellite.ts";
import { statusLines, statusTool } from "./status.ts";

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

/* eslint-disable @typescript-eslint/no-explicit-any -- ответы моста приходят без схемы */

/** Мост одной сессии. */
export interface Slot extends KeptSlot, SatelliteSlot {
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

const hhmm = (): string => new Date().toTimeString().slice(0, 5);

export interface ToolsHalf {
  /** Сессия умерла — её мост отпускается вместе со стоянием. */
  forget(session: string): void;
  /** Событие сервиса: ход, текст, удаление ведущего субагента (leads.ts, #6625). */
  onEvent(ev: any): void;
  /** Первый промпт сессии — строка запуска с делом исполняется до хода модели (launch.ts). */
  launch(session: string, text: string): Promise<string | null>;
  stop(): void | Promise<void>;
  bridgeOf(session: string): Bridge | null; // мост держащего слота — для расхода сессии (usage.ts)
}

export async function setupTools(
  ctx: Context,
  say: Say,
  onChannel: (session: string | null, params: any, child?: boolean) => void,
  rootOf: (sessionID: string) => Promise<string>,
  flushUsage: (session: string) => Promise<void> = async () => {},
): Promise<ToolsHalf> {
  const found = findBridge();
  if (!found.path) {
    say(
      "Искрон: мост не найден — тулов iskron_* в этой сессии не будет. Искал: " +
        found.tried.join(", ") +
        ". Задай ISKRON_BRIDGE_PATH или поставь мост скиллом establish-mcp.",
      "error",
    );
    return { forget() {}, onEvent() {}, launch: async () => null, stop() {}, bridgeOf: () => null };
  }
  const path = found.path;
  const builds = buildsLine(path, import.meta.url);
  const hostEnv = await hostEnvOf(ctx); // версия OpenCode и корень набора — раз на плагин

  const slots = new Map<string, Slot>();
  let spare: Slot | null = null;
  let stopped = false;

  // Человек в браузере — один вход на все мосты плагина (login.ts).
  const login = createLogin(say);

  function spawn(args: string[] = []): Slot {
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
        if (kind === "held") slot.place = heldPlace(params?.data) ?? slot.place; // #6002
        if (kind === "released" || kind === "dead" || kind === "evicted") slot.holding = false;
        if (slot.child && slot.session) leads.heard(slot.session, kind, slot.place); // #6625
        onChannel(slot.session, params, !!slot.child);
      },
      (e) => {
        // Держащий мост вышел не по нашей воле — слух потерян, и это слово в
        // сессию, а не строка в лог, которого никто не читает (#5140).
        if (slot.ownStop || stopped || !slot.holding) return;
        slot.holding = false;
        const text =
          `Искрон: слух потерян в ${hhmm()} — мост стояния вышел (${e.message}). ` +
          "Сторож слуха поднимет мост и вернёт место с диска; не ждёшь — iskron_stand.";
        const lost = { logger: "iskron-channel", data: { kind: "lost", text } };
        onChannel(slot.session, lost, !!slot.child); // слух ребёнка — слово только ему (#6625)
      },
      args,
    );
    slot.bridge.start(hostEnv);
    shake(slot);
    return slot;
  }

  const directoryOf = (sessionID: string) => sessionDirectory(ctx, sessionID);
  const exists = (sessionID: string): Promise<boolean> =>
    Promise.resolve()
      .then(() => ctx.session.get({ sessionID } as any))
      .then(
        () => true,
        () => false,
      );
  const runEnds = createRunEnds(); // кончившиеся дети: запись с места — отказ вслух (#6361)
  // Ведущие субагенты (#6625): конец — явный акт, итог — синтетикой родителю.
  const endChild = (c: string) =>
    runEnds.end(c, slots.get(c)?.satelliteOf, forget, leads.released(c));
  const leads = createLeads(leadDoors(ctx, say, flushUsage, endChild));
  const keeper = createKeeper({
    say,
    tell: (root, text, child) =>
      onChannel(root, { logger: "iskron-channel", data: { kind: "resumed", text } }, !!child),
    lost: (root, text) =>
      onChannel(root, { logger: "iskron-channel", data: { kind: "lost", text } }),
    slotFor: (root, touch) => slotFor(root, touch),
    ready: readyFor,
    directoryOf,
    exists,
  });
  const children = createChildren({ slots, spawn, keeper, leads, exists });
  // Прежний экземпляр остановили с держащим мостом: ключи его мест — сторожу,
  // чтобы возврат шёл по ключу, не по каталогу; места — обратно сразу, со словом
  // в державшие сессии (keeper.resumeLost), в первую живую — лишь когда таких нет.
  const lost = takeLostMarker(authDir());
  let lostWord = lost?.text ?? null;
  if (lost) {
    say(lost.text, "warning");
    keeper.hint(lost.entries);
    // Дети прежнего экземпляра (#6625): место-спутник обратно по ключу, тихо (children.ts).
    for (const e of lost.entries) if (e.child && e.session) void children.back(e);
  }

  function shake(slot: Slot): void {
    slot.ready = handshake(slot.bridge, login.on, login.done);
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
      const live = own.bridge.failure ? children.childSlot(sessionID) : own;
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
      slot = spare && !spare.bridge.failure ? spare : spawn();
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

  // Мост молчащей сессии без стояния не живёт вечно: opencode run плодит сессии, а запас без сессии — каждая локация сервиса.
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
    statusLines(
      path,
      builds,
      { loginPending: login.pending, loginUrl: login.url, loginDevice: login.device },
      state,
      slots.size,
      spare ? 1 : 0,
    );

  await ctx.tool.transform((editor) => {
    editor.add(statusTool(statusText));
    for (const t of state.listed) {
      const name = String(t.name);
      editor.add({
        name,
        description: String(t.description ?? ""),
        // JSON Schema сервера без паспорта диалекта — той же срезкой, что у pi.
        input: toParameters(t.inputSchema),
        async execute(input, tool) {
          // revoke места своего ведущего субагента — слово запустившего: конец исполняет плагин (#6625).
          const word = await leads.release(String(tool.sessionID), name, input ?? {});
          if (word) return { content: word };
          runEnds.guard(String(tool.sessionID), name, input ?? {}); // не мостом корня (#6361)
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

  /** Рукопожатие слота под гонкой со входом: человека внутри вызова не ждут, адрес входа уходит ответом. */
  const awaitReady = (slot: Slot): Promise<void> => login.race(() => readyFor(slot));

  /** Один вызов тула через мост слота. */
  async function callThrough(
    slot: Slot,
    name: string,
    input: any,
    sessionID: string,
    service = false, // строка запуска — служебный ход, не работа агента (#6510)
  ): Promise<{ content: string }> {
    await awaitReady(slot);
    if (slot.resume) await slot.resume; // место возвращается с диска — не занимать его дважды
    // Потолка нет: контекст execute в v2 сигнала отмены не несёт.
    const args: Record<string, unknown> = { ...(input ?? {}) };
    // В графе место одно на мост: дочерняя сессия (субагент), встающая своим вызовом,
    // получает свой мост, а не мост корня, — иначе её место снимало бы
    // родительское с сокета, а её register переписывал бы привязку корня (#5154).
    if (standsBy(name, args) && slot.session !== sessionID) {
      slot = children.childSlot(sessionID, slot);
      await awaitReady(slot); // свежий детский мост может запросить вход — та же гонка, что у корня
    }
    const busy = name === STAND_TOOL && asSatellite(args, slot.satelliteOf, !!slot.place);
    // Мост бежит из cwd сервера OpenCode, не из рабочей копии сессии:
    // репо для имени стояния он выводит из директории сессии (r5 #5108) —
    // той, чей это мост: корня для корня, дочерней для её собственного.
    if (name === STAND_TOOL && !args.cwd) {
      const dir = (slot.dir ??= await directoryOf(slot.session ?? sessionID));
      if (dir) args.cwd = dir;
    }
    const result = await slot.bridge.request("tools/call", { name, arguments: args }, { service });
    // Отказ тула сигналится броском — так OpenCode показывает его отказом.
    if (result?.isError) throw new Error(textOf(result) || `${name}: отказ без текста`);
    // Ответ тула — наблюдаемое событие держания; ответ одной занятости — нет (#6509).
    if (standsBy(name, args) && !busy) keeper.stood(slot);
    if (standsBy(name, args)) runEnds.clear(sessionID); // встал заново — запись снова своим мостом
    // Ребёнок, вставший своим мостом, — ведущий; его уход по исходу — конец (#6625).
    if (slot.child && slot.session === sessionID) leads.called(sessionID, name, args, slot.place);
    return { content: textOf(result) };
  }
  if (state.listed.length)
    say(`Искрон: тулов из прошлого списка: ${state.listed.length}; сверю с сервером.`, "info");

  // Первый мост — ради списка тулов, фоном и без потолка: истёкшее ожидание входа или умерший мост — новое рукопожатие или новый мост, пока плагин жив.
  spare = spawn();
  let first = spare;
  let [misses, deaths] = [0, 0]; // deaths — смерти подряд: пауза замены растёт, не шторм запусков
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
          // список берёт новый запас сразу, до паузы: мёртвый запас сессии не отдаётся.
          if (first.session === null)
            say(`Искрон: мост умер (${(e as Error).message}) — поднимаю новый.`, "warning");
          if (spare === first) spare = null;
          first = spare ?? spawn();
          spare = first;
          await sleep(retryPause(deaths++));
        } else {
          await sleep(retryPause(misses++)); // пауза до повтора: удавшийся — сразу к списку
          shake(first);
        }
      }
    }
  })();

  if (lost) {
    // Вызов тула другой сессии в этом окне слова о чужой потере не берёт;
    // державших сессий нет — слово ждёт первую живую, как прежде.
    const word = lostWord;
    lostWord = null;
    void keeper.resumeLost(lost.entries, word).then((said) => {
      if (!said) lostWord ??= word;
    });
  }

  // Строка запуска с делом (launch.ts): тот же вызов, что у execute, с его занятостью.
  const launcher = createLauncher<Slot>({
    rootOf,
    childSlot: (sessionID, root) => children.childSlot(sessionID, slots.get(root)),
    async call(slot, name, args, sessionID) {
      slot.busy++;
      try {
        return (await callThrough(slot, name, args, sessionID, true)).content;
      } finally {
        slot.busy--;
        slot.lastCall = Date.now();
      }
    },
  });

  function forget(session: string): void {
    runEnds.clear(session); // удалённая сессия уносит и пометку конца прогона
    launcher.forget(session);
    keeper.forget(session);
    const slot = slots.get(session);
    if (!slot) return;
    slots.delete(session);
    slot.ownStop = true;
    slot.bridge.stop(); // свёртка моста отпускает стояние: ключ, сокет, занятость
  }

  return {
    launch: launcher.launch,
    bridgeOf: (s) => [slots.get(s)].find((x) => x?.holding)?.bridge ?? null,
    forget(s) {
      forget(s);
      runEnds.clear(s, true); // сессии нет — и окончательной пометки нет
    },
    onEvent: (ev) => leads.onEvent(ev),
    async stop() {
      stopped = true;
      clearInterval(reaper);
      leads.stop();
      keeper.stop();
      await children.pause(); // перезагрузка — не конец ребёнка (#6625): место и дела ждут
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
