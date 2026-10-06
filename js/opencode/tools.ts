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
import { createAdopt } from "./adopt.ts";
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
import { idleHalf, type ToolsHalf } from "./half.ts";
import { hostEnvOf } from "./host.ts";
import { createKeeper } from "./keep.ts";
import { holdersOf } from "./keepalive.ts";
import { createLauncher } from "./launch.ts";
import { createLeads } from "./leads.ts";
import { leadDoors } from "./leadwords.ts";
import { createLogin } from "./login.ts";
import { takeLostMarker, writeLostMarker } from "./marker.ts";
import { createMoves } from "./moves.ts";
import type { Context } from "./plugin.ts";
import { childWriteRefusal, createRunEnds, declaresAction } from "./runends.ts";
import { asSatellite, heldPlace, STAND_TOOL, standsBy } from "./satellite.ts";
import { IDLE_MS, REAP_MS, type Slot } from "./slot.ts";
import { statusLines, statusTool } from "./status.ts";

export type Say = (text: string, level: "info" | "warning" | "error") => void;

/* eslint-disable @typescript-eslint/no-explicit-any -- ответы моста приходят без схемы */

export type { Slot } from "./slot.ts";

const hhmm = (): string => new Date().toTimeString().slice(0, 5);

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
    return idleHalf();
  }
  const path = found.path;
  const builds = buildsLine(path, import.meta.url);
  const hostEnv = await hostEnvOf(ctx); // версия OpenCode и корень набора — раз на плагин

  const slots = new Map<string, Slot>();
  const unasked = new WeakSet<Slot>(); // слот корня, ещё не спросивший место с диска
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
        // Ведущий — только ребёнок-спутник (#6550 п.4); ребёнок на обычном мосте — один прогон (children.ts).
        const over =
          !!slot.child &&
          !!slot.satelliteOf &&
          !!slot.session &&
          leads.heard(slot.session, kind, slot.place);
        if (!over) relay(slot.session, params, !!slot.child); // кончившемуся ведущему слов о канале нет
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

  // Локация экземпляра: перенесённая сессия зовёт тулы через экземпляр новой папки (moves.ts).
  const mv = createMoves(ctx);
  const { home, directoryOf, exists, ours } = mv;
  const relay = mv.relay(onChannel, say);
  const runEnds = createRunEnds(); // кончившиеся дети: запись с места — отказ вслух (#6361)
  // Ведущие субагенты (#6625): конец — явный акт, итог — синтетикой родителю.
  const endChild = (c: string, out: ((s: string) => void) | null = forget) =>
    runEnds.end(c, slots.get(c)?.satelliteOf, out, leads.released(c), leads.goneWhy(c));
  const leads = createLeads(leadDoors(ctx, say, flushUsage, endChild, slots));
  const keeper = createKeeper({
    say,
    tell: (root, text, child) =>
      onChannel(root, { logger: "iskron-channel", data: { kind: "resumed", text } }, !!child),
    lost: (root, text) =>
      onChannel(root, { logger: "iskron-channel", data: { kind: "lost", text } }),
    slotFor: (root, touch) => slotFor(root, touch),
    ready: readyFor,
    directoryOf,
    exists: ours,
  });
  // Ребёнок прежнего экземпляра слота здесь не имеет: гасить нечего (и forget зовётся до конца setup).
  const nothing = () => {};
  const endRun = (s: string, live = true) =>
    live
      ? void flushUsage(s).finally(() => runEnds.end(s, null, forget))
      : runEnds.end(s, null, nothing);
  const children = createChildren({ slots, spawn, keeper, leads, exists, endRun, forget });
  const adopt = createAdopt({
    keeper,
    authDir,
    home,
    back: (e) => children.back(e),
    endKid: (s, of, why) => runEnds.end(s, of, nothing, false, why),
  });
  // Прежний экземпляр остановили с держащим мостом (или сессию перенесли сюда): ключи
  // мест — сторожу, места — обратно сразу, каждой державшей сессии — слово о её местах
  // (keeper.resumeLost); не державшей — ни слова о чужих. Только маркеры своей локации (#6626).
  const lost = takeLostMarker(authDir(), home);
  if (lost?.text) say(lost.text, "warning");
  if (lost) adopt.take(lost.entries);

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
    mv.guard(root, sessionID); // корень перенесён отсюда — ребёнку не поднимать его мост здесь
    // Дочерняя сессия, вставшая своим спутником, ходит своим мостом (#5154); без
    // него мост корня ей — только на чтение: запись отказывает execute (#6550 п.2).
    if (root !== sessionID && !slots.has(sessionID)) {
      adopt.now(); // маркер прежнего экземпляра, положенный после нашей загрузки (adopt.ts)
      await children.settled(sessionID);
    }
    const own = root !== sessionID ? slots.get(sessionID) : undefined;
    if (own) {
      // Умерший детский мост заменяется своим же, не мостом корня: чтения и
      // записи ребёнка не уходят под привязку корня, сторож возвращает его место.
      const live = own.bridge.failure ? children.childSlot(sessionID) : own;
      if (touch) live.lastCall = Date.now();
      return live;
    }
    // Ребёнок, перенесённый в другой каталог (#6695): корень держит экземпляр каталога родителя,
    // либо он чужой — место корня отсюда не возвращается. Решается на каждом вызове, не слотом.
    const far = root !== sessionID && !slots.get(root)?.place ? await mv.farRoot(root) : null;
    if (far && far !== "foreign") return far;
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
      unasked.add(slot);
    }
    // Место прежнего экземпляра плагина (вытеснение каталога, перезапуск) возвращается
    // с диска по каталогу сессии — до первого вызова тула; корнем чужим — никогда.
    const s = slot;
    if (far !== "foreign" && unasked.delete(s))
      s.resume = keeper.resume(s, root).finally(() => (s.resume = null));
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
      const asks = declaresAction(t.inputSchema); // «?» — справка только у тула с action
      editor.add({
        name,
        description: String(t.description ?? ""),
        // JSON Schema сервера без паспорта диалекта — той же срезкой, что у pi.
        input: toParameters(t.inputSchema),
        async execute(input, tool) {
          // revoke места своего ведущего субагента — слово запустившего: конец исполняет плагин (#6625).
          // …и ребёнка, кончённого переносом родителя: снимать нечего (adopt.ts).
          const word =
            (await leads.release(String(tool.sessionID), name, input ?? {})) ??
            adopt.revoked(name, input ?? {});
          if (word) return { content: word };
          await children.settled(String(tool.sessionID)); // ребёнок маркера: слот ещё встаёт
          runEnds.guard(String(tool.sessionID), name, input ?? {}, asks); // не мостом корня (#6361)
          const slot = await slotFor(String(tool.sessionID));
          // Ребёнок мостом корня — только читает; встаёт — своим спутником в callThrough (#6550 п.2).
          const no =
            slot.session !== tool.sessionID && !standsBy(name, input ?? {})
              ? childWriteRefusal(slot.place?.name ?? null, name, input ?? {}, asks)
              : null;
          if (no) throw new Error(no);
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
      // Место родителя неизвестно — не обычное место и не место рядом, а отказ (#6550 п.2).
      if (!slot.place)
        throw new Error(
          (await mv.farRefusal(slot.session)) ?? childWriteRefusal(null, name, args, false) ?? "",
        );
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
    if (slot.child && slot.satelliteOf && slot.session === sessionID)
      leads.called(sessionID, name, args, slot.place);
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

  if (lost) void keeper.resumeLost(lost.entries, lost.wordFor); // каждой — о её местах

  // Строка запуска с делом (launch.ts): тот же вызов, что у execute, с его занятостью.
  const launcher = createLauncher<Slot>({
    rootOf,
    childSlot(sessionID, root) {
      if (!slots.get(root)?.place)
        throw new Error(childWriteRefusal(null, STAND_TOOL, {}, false) ?? "");
      return children.childSlot(sessionID, slots.get(root)); // без места корня — отказ (#6550 п.2)
    },
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
    leadOf: (s) => leads.nameOf(s),
    holders: () => holdersOf(slots.values()),
    owns: (s) => slots.has(s),
    held: (r) => [slots.get(r)].find((x) => x?.holding && x.place && !x.bridge.failure) ?? null,
    adopt: () => adopt.now(),
    // Ребёнок-спутник, перенесённый один, едет своим спутником в новую папку (children.ts, #6695).
    moved: (s, to) =>
      children.handoff(s, to, home) ||
      mv.moved({ say, slots, rootOf, forget, slotFor, adopt: adopt.now, away: leads.away }, s, to),
    async stop() {
      stopped = true;
      clearInterval(reaper);
      keeper.stop();
      await children.pause(); // перезагрузка — не конец ребёнка (#6625): место и дела ждут
      // Остановка с держащими мостами — на диск: следующий экземпляр скажет о потере.
      const left = writeLostMarker(authDir(), slots.values(), home);
      if (spare) spare.ownStop = true;
      spare?.bridge.stop();
      spare = null;
      for (const slot of slots.values()) {
        slot.ownStop = true;
        slot.bridge.stop();
      }
      slots.clear();
      return left; // близнецу каталога — будить экземпляр этого написания (twins.ts)
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
