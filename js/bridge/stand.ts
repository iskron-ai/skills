// iskron_stand — тул моста, занимающий стояние одним вызовом (граф nks-dev:
// феномен #4511, вопрошание #4508, превращение #4504). На сервер он не
// уходит: мост исполняет его сам теми же вызовами, которыми агент прежде шёл
// по скиллу standing, — доска, выведенное имя, connect и register (либо один
// register, когда сокет уже держит этот мост: живое стояние не ротируется без
// причины), хук инбокса роли, стук в место человека по полному адресу с провода
// (один раз за сессию: второй join — повтор, не разговор), занятость. Ответ
// один: имя, команда сторожа, ожидавшие кадры, хук, расписка стука.
// Отсутствие тула в сессии — тулы идут мимо моста либо мост старой сборки.
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";

import { nameOf, parseBoard } from "./board.ts";
import {
  besideRefusal,
  callTool as call,
  leadsOtherPlace,
  otherPlaceWord,
  resolveAgainstLed,
  short,
  unresolvedRefusal,
} from "./call.ts";
import { CFG } from "./config.ts";
import {
  awaitHello,
  hasStatusAddressFor,
  holdsStanding,
  isParked,
  ledKey,
  noteStandCwd,
  standingIdIn,
  wasEvicted,
} from "./hold.ts";
import { keyOf } from "./holdrecord.ts";
import { armRoleHook } from "./hook.ts";
import { returnToStanding } from "./leave.ts";
import { listenBlock } from "./listen.ts";
import {
  deriveParts,
  fitName,
  git,
  joinName,
  NAME_MAX,
  nameFault,
  normKarta,
  normName,
  sanitize,
} from "./names.ts";
import { placeFields, rememberModel } from "./placefields.ts";
import { otherRealm } from "./realms.ts";
import { deadPredecessor, resumeFromDisk } from "./resume.ts";
import { SATELLITE_TTL_S, satelliteGate, satelliteListenWord, ttlRefused } from "./satellite.ts";
import { separatePlace, suffixOf } from "./separate.ts";
import { SW } from "./standwords.ts";
import { publishStatus, TAKE_PATH, TURNED_GUIDANCE } from "./status.ts";
import { state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";
import { readLatest, staleNotice } from "./update.ts";

/** Имя места, которое ведёт мост, — для совета в отказе «стояние одно на мост». */
const ledName = (): string => state.standing?.name ?? "";

export { STAND_TOOL } from "./standtool.ts";

const isDirectory = (p: string): boolean => {
  try {
    return isAbsolute(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
};

export const isStandCall = (msg: JsonRpcMessage): boolean =>
  msg?.method === "tools/call" && msg?.params?.name === "iskron_stand";

/**
 * Стуки в места людей — когда и сколько, ключ (граф, роль, имя, адрес места). Правило
 * ожидания — #4342. Запись живёт в процессе моста и умирает с ним; новый цикл
 * входа (connect — свежий сокет) сбрасывает счёт по этому месту: предел повторов
 * — на один заход, не пожизненный запрет.
 */
const knocks = new Map<string, { at: number; count: number }>();
// Окно повтора — 2 минуты по #4342; переменная — шов для проб, не ручка человека.
const KNOCK_REPEAT_AFTER_MS = Number(process.env.ISKRON_STAND_KNOCK_REPEAT_MS) || 120_000;
const KNOCK_LIMIT = 2;

export async function runStand(msg: JsonRpcMessage): Promise<JsonRpcMessage> {
  const a = msg.params?.arguments ?? {};
  const realm = typeof a.realm === "string" ? a.realm.trim() : "";
  const karta = a.karta != null ? normKarta(a.karta) : "";
  const lines: string[] = [];
  const done = (isError = false): JsonRpcMessage => ({
    jsonrpc: "2.0",
    id: msg.id,
    result: {
      ...(isError ? { isError: true } : {}),
      content: [{ type: "text", text: lines.join("\n") }],
    },
  });
  if (!realm || !karta) {
    lines.push(SW.needRealmKarta());
    return done(true);
  }
  const model = typeof a.model === "string" && a.model.trim() ? a.model : undefined;
  rememberModel(model);
  const cwd = typeof a.cwd === "string" && a.cwd.trim() ? a.cwd.trim() : process.cwd();
  // Кривой cwd адресовал бы другое место (репо из несуществующего или чужого
  // каталога) — отказ вслух, как у явного имени (#5068).
  if (cwd !== process.cwd() && !isDirectory(cwd)) {
    lines.push(SW.badCwd(cwd, !isAbsolute(cwd)));
    return done(true);
  }
  const nameNotes: string[] = [];
  // Имя — адрес места: явное имя либо принимается ровно таким, либо отвергается
  // вслух с названной причиной; молча укороченное имя адресует ДРУГОЕ место
  // (граф nks-dev: #5068). Выведенное имя укорачивается до предела сервера с
  // пометкой сразу после шапки ответа.
  const asked = normName(a.name);
  if (asked) {
    const fault = nameFault(asked);
    if (fault) {
      lines.push(SW.badName(asked, fault, NAME_MAX));
      return done(true);
    }
  }
  // Место-спутник субагента (satellite.ts, #6002): только у моста-спутника и только оно у него.
  const gate = await satelliteGate(a, realm, karta, asked);
  if (gate && !gate.ok) {
    lines.push(gate.refusal);
    return done(true);
  }
  const sat = gate?.ok ? { name: gate.name, caller: gate.caller } : null;
  if (gate?.ok) nameNotes.push(...gate.notes);
  const parts = asked || sat ? null : deriveParts(model, cwd);
  const fitted = parts ? fitName(parts) : null;
  const derived = asked || sat ? "" : (fitted?.name ?? "");
  let name = asked || sat?.name || derived;
  await resolveAgainstLed(realm); // графы сличаются в одной форме @owner/slug (#5838)
  // Мост уже стоит на отдельном месте этого выведенного имени — туда же (#5407).
  const led0 = state.standing && !otherRealm(state.standing.realm, realm) ? state.standing : null;
  if (derived && led0 && String(led0.karta) === String(karta) && suffixOf(derived, led0.name ?? ""))
    name = led0.name ?? name;
  if (parts && fitted && fitted.cut.length) {
    const what = fitted.cut.map(SW.cutPart).join(", ");
    nameNotes.push(SW.nameCut(joinName(parts), NAME_MAX, name, what));
  }
  if (!asked && !sat && !model) nameNotes.push(SW.noModel());
  const room = typeof a.room === "string" && a.room.trim() ? a.room.trim() : null;
  // Стояние одно на мост (#5154): другое место при ведомом своём — только по
  // явному take=true; иначе отказ вслух, и ничего не тронуто.
  // Имя графа, не разрешённое в @owner/slug, против графов своих мест — отказ, не догадка (#5838).
  const unresolved = unresolvedRefusal(realm);
  if (unresolved) {
    lines.push(unresolved);
    return done(true);
  }
  const led = leadsOtherPlace(realm, karta, name);
  if (led && a.take !== true) {
    lines.push(otherPlaceWord(led, keyOf(realm, karta, name), name === ledName()));
    return done(true);
  }
  // Место другого графа встаёт рядом на канале, который держит мост (#5838).
  const noChannel = besideRefusal(realm, "stand");
  if (noChannel) {
    lines.push(noChannel);
    return done(true);
  }
  const prim = state.standing;
  const beside = !!prim && otherRealm(realm, prim.realm) && !holdsStanding(realm, karta, name);
  // Каталог сессии — в запись держания: мост, поднятый заново (вытеснение
  // каталога OpenCode, перезапуск плагина), вернёт место по нему сам (#5140).
  noteStandCwd(cwd);

  const here = () => placeFields({ realm, karta, name }); // поля места — каждой регистрации (#5174)
  const register = () =>
    call("iskron_channel", { action: "register", realm, karta, name, ...here() });

  // 1. Доска — до любой перемены.
  const board = await call("iskron_channel", { action: "list", realm });
  if (board.isError) {
    lines.push(SW.boardUnread(short(board.text)));
    return done(true);
  }
  const entries = parseBoard(board.text);
  // Доска — проза сервера (#4514). Управляющие действия — ротация, стук, хук —
  // идут только по распознанной однозначной форме; иначе честный отказ.
  const header = /^\s*Каналы(?:\s*\((\d+)\))?(?:\s|:|$)/m.exec(board.text);
  const declared = header?.[1] != null ? Number(header[1]) : null;
  // Пустой граф — законная пустота; наблюдённые фразы держит узел формы доски (#4514).
  const empty = /^\s*Ни одна роль этого графа (?:не держит канала|нигде не стоит)/m.test(
    board.text,
  );
  const recognized = !!header || empty || entries.length > 0;
  let own = entries.filter((e) => e.karta === karta && nameOf(e.address) === name);
  // Выведенное имя держит живой мост другой сессии — встаём рядом на имя.N (#5407).
  const separate =
    derived && a.take !== true && name === derived
      ? await separatePlace(realm, karta, derived)
      : null;
  if (separate) {
    name = separate.name;
    own = entries.filter((e) => e.karta === karta && nameOf(e.address) === name);
    nameNotes.push(separate.note);
  }
  const sub = !!sat || (!!derived && name !== derived); // отдельное место и спутник: хук инбокса роли не взводится
  // Места прежнего стандарта имени (машина.репо.ветка) той же машины и репо —
  // сироты после перехода на машина.репо.модель: их адрес держат ростеры дел
  // и хуки инбокса, а слушает их никто. Прежнее имя узнаётся по третьей части,
  // равной имени локальной ветки, — иначе это сосед на другой модели, и его
  // место трогать нельзя.
  const stem = name.split(".").slice(0, 2).join(".");
  const branches = new Set(
    git(["branch", "--format=%(refname:short)"], cwd)
      .split("\n")
      .map((x) => sanitize(x.trim()))
      .filter(Boolean),
  );
  const legacy = entries.filter((e) => {
    if (sat) return false; // спутнику прежние места позвавшего не его забота
    if (e.karta !== karta || nameOf(e.address) === name) return false;
    const own = nameOf(e.address);
    if (!own.startsWith(`${stem}.`)) return false;
    const third = own.slice(stem.length + 1);
    return branches.has(third) && /живой|слушает/.test(e.rest);
  });
  for (const e of legacy) nameNotes.push(SW.legacy(e.address, realm, karta));
  // Счёт в заголовке не сошёлся с разобранным — где-то строка, которой парсер не
  // понял; она могла быть твоим живым местом. Ротировать вслепую нельзя, а
  // явный take=true — слово делателя, что он это понимает.
  const unread = declared != null && declared !== entries.length;
  if (!recognized || own.length > 1 || (unread && own.length === 0 && a.take !== true)) {
    lines.push(
      !recognized
        ? SW.boardUnknown(short(board.text, 160))
        : own.length > 1
          ? SW.boardAmbiguous(own.length, name, karta)
          : SW.boardCount(declared ?? 0, entries.length),
    );
    return done(true);
  }
  if (unread) lines.push(SW.boardCountFound(declared ?? 0, entries.length));
  const mine = own[0];
  let incoming = mine?.incoming ?? null;

  // 2. Место. Свой сокет держит этот мост — register. Место слушает ДРУГОЙ мост
  // (та же рабочая копия в другой сессии) — тоже register: живое стояние не
  // ротируется без причины (#4342), а причина называется явно — take=true.
  // Иначе connect и register; новый сокет — новый цикл входа, счёт стуков сброшен.
  let how: string;
  let heardHere: boolean;
  const listensElsewhere =
    !!mine && /(^|·)\s*слушает/.test(mine.rest) && !holdsStanding(realm, karta, name);
  // Мост поднят заново под местом, которое держал прежний мост этого каталога
  // (перезапуск плагина, /mcp reconnect): место возвращается с диска, не
  // ротируется — адрес, хуки и очередь те же (#5061). Доска ещё читает
  // «слушает» (окно платформы после смерти прежнего моста) — только register,
  // как велит канон, и ответ говорит, что слушающий — мёртвый предшественник.
  // Спутник с диска не возвращается: его место живёт прогоном (satellite.ts).
  const fresh =
    !sat && a.take !== true && !holdsStanding(realm, karta, name) && !isParked(realm, karta, name);
  const predecessorDead = fresh && listensElsewhere && (await deadPredecessor(realm, karta, name));
  const resumed = fresh && !listensElsewhere ? await resumeFromDisk(realm, karta, name) : null;
  const extra: string[] = []; // строки после шапки ответа
  // Сокет держал этот мост и до вызова (свой register, возврат с диска): hello не ждать.
  let socketBefore = false;
  // take=true — явный новый цикл входа: connect и тогда, когда сокет уже наш.
  if (beside) {
    // Канал держит места в нескольких графах: register на нём в этом графе
    // добавляет место, сокет тот же — connect открыл бы второй канал (#5838).
    const r = await register();
    if (r.isError) {
      lines.push(SW.refused("register", short(r.text)));
      return done(true);
    }
    heardHere = holdsStanding(realm, karta, name);
    // id места — из ответа register (standing.ts); без него кадры места найдут его по графу и адресу.
    if (heardHere && !standingIdIn(realm)) extra.push(SW.noIdInRegister());
    how = SW.howBeside(ledKey() ?? "");
  } else if (resumed) {
    const r = await register();
    if (r.isError) {
      lines.push(SW.refused("register", short(r.text)));
      return done(true);
    }
    heardHere = true;
    socketBefore = true;
    // Строку занятости из записи возврат не публикует заново (#6017): свежая
    // отметка выдала бы прежнее слово о работе за сказанное сейчас.
    how = `${resumed.word}, register`;
  } else if (a.take !== true && isParked(realm, karta, name) && returnToStanding("iskron_stand")) {
    // Ушёл с места и вернулся: тот же адрес, сокет открыт заново, register — атрибуция.
    const r = await register();
    if (r.isError) {
      lines.push(SW.refused("register", short(r.text)));
      return done(true);
    }
    heardHere = true;
    how = SW.howReturned();
  } else if (a.take !== true && (holdsStanding(realm, karta, name) || listensElsewhere)) {
    const r = await register();
    if (r.isError) {
      lines.push(SW.refused("register", short(r.text)));
      return done(true);
    }
    heardHere = !listensElsewhere;
    socketBefore = !listensElsewhere;
    how = listensElsewhere
      ? wasEvicted(realm, karta, name)
        ? SW.howEvicted()
        : predecessorDead
          ? SW.howDeadPredecessor()
          : SW.howOtherHolder()
      : SW.howRegister();
  } else {
    const args: Record<string, unknown> = { action: "connect", realm, karta, name };
    Object.assign(args, here());
    if (typeof a.mute_siblings === "boolean") args.mute_siblings = a.mute_siblings;
    if (sat) args.ttl_seconds = SATELLITE_TTL_S; // приглашения спутнику не переживают прогон (#6001, условие а)
    let c = await call("iskron_channel", args); // новый сокет держатель берёт сам и заново: кольцо кадров чистое
    if (sat && c.isError && ttlRefused(c.text)) {
      // Разброс окна держит контур; вне его — место всё же нужно прогону, окно — умолчание контура.
      extra.push(SW.ttlRefused(SATELLITE_TTL_S, short(c.text, 120)));
      delete args.ttl_seconds;
      c = await call("iskron_channel", args);
    }
    if (c.isError) {
      lines.push(SW.refused("connect", short(c.text)));
      return done(true);
    }
    incoming = /https?:\/\/\S+\/channel\/in\/\S+/.exec(c.text)?.[0] ?? incoming;
    const r = await register();
    if (r.isError) {
      lines.push(SW.takenButRegister(short(r.text)));
      return done(true);
    }
    for (const k of [...knocks.keys()])
      if (k.startsWith(`${realm}|${karta}|${name}|`)) knocks.delete(k);
    heardHere = true;
    how = SW.howConnect(!!mine, listensElsewhere, a.take === true);
  }
  lines.push(
    SW.head(mine?.address ?? name, karta, realm, how),
    ...nameNotes.map((n) => `[iskron_stand] ${n}`),
    ...extra,
  );
  const block = heardHere ? (sat ? satelliteListenWord() : listenBlock(realm)) : null;
  if (block) lines.push(block);
  else lines.push(heardHere ? SW.noSocket() : SW.noWatchdog());

  // 3. hello — доказательство держания; свежий он только за connect этого вызова.
  if (!heardHere) lines.push(beside ? SW.besideNoDoor() : SW.hearingElsewhere());
  else if (beside) lines.push(SW.besideHeard());
  else if (socketBefore) lines.push(SW.heldAlready());
  else {
    const hello = await awaitHello(4000);
    lines.push(hello ? SW.hello(String(hello.pending ?? 0)) : SW.noHello());
  }

  // 4. Хук инбокса роли — чтобы вимарша posed_to приходила тем же сокетом.
  const main = state.standing;
  lines.push(
    await armRoleHook({
      realm,
      karta,
      name,
      incoming,
      heardHere,
      sub,
      beside: !!main && otherRealm(realm, main.realm), // место на канале, открытом в другом графе
      channelRealm: main?.realm ?? realm,
    }),
  );

  // 5. Стук в место человека — по полному адресу с провода. Правило #4342: один стук,
  // повтор один раз не раньше чем через две минуты, дальше — слово человеку.
  if (room && !heardHere) {
    lines.push(SW.knockNotHere(room));
  } else if (room) {
    const onBoard = entries.find((e) => e.address === room);
    const roomKarta =
      onBoard?.karta ??
      (typeof a.room_karta === "string" && a.room_karta.trim()
        ? a.room_karta.trim().replace(/^#/, "")
        : null);
    const key = `${realm}|${karta}|${name}|${room}`;
    const prior = knocks.get(key);
    const waited = prior ? Date.now() - prior.at : Infinity;
    const again = a.repeat_knock === true;
    if (prior && prior.count >= KNOCK_LIMIT) lines.push(SW.knockTwice(room));
    else if (prior && !again) lines.push(SW.knockSent(room, waited, KNOCK_REPEAT_AFTER_MS));
    else if (prior && waited < KNOCK_REPEAT_AFTER_MS)
      lines.push(SW.knockEarly(room, waited, KNOCK_REPEAT_AFTER_MS));
    else if (!roomKarta) lines.push(SW.knockNoRole(room, realm));
    else {
      const s = await call("iskron_channel", {
        action: "send",
        realm,
        karta: roomKarta,
        standing: room,
        text: "join",
      });
      if (s.isError) lines.push(SW.knockRefused(room, short(s.text)));
      else {
        knocks.set(key, { at: Date.now(), count: (prior?.count ?? 0) + 1 });
        lines.push(SW.knockDone(room, !!prior, short(s.text, 200)));
      }
    }
  }

  // 6. Занятость — от стояния, которое ведёт мост, не от живого сокета (#5033):
  // и при «только register», и после вытеснения, пока статусный адрес у моста.
  if (typeof a.status === "string" && a.status.trim() && !hasStatusAddressFor(realm, karta, name)) {
    lines.push(predecessorDead ? SW.statusAfterDead() : SW.statusElsewhere(TAKE_PATH()));
  } else if (typeof a.status === "string" && a.status.trim()) {
    const st = await publishStatus(a.status.trim(), realm);
    lines.push(
      st.ok
        ? SW.status(a.status.trim())
        : SW.statusRefused(short(st.body), st.code === 404 ? ` ${TURNED_GUIDANCE()}` : ""),
    );
  }
  const stale = staleNotice(readLatest(CFG.authDir), CFG.authDir);
  if (stale) lines.push(stale);
  return done();
}
