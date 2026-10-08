// iskron_stand — тул моста, занимающий стояние одним вызовом (граф nks-dev:
// феномен #4511, вопрошание #4508, превращение #4504). На сервер он не
// уходит: мост исполняет его сам теми же вызовами, которыми агент прежде шёл
// по скиллу standing, — доска, выведенное имя, connect и register (либо один
// register, когда сокет уже держит этот мост: живое стояние не ротируется без
// причины), хук инбокса роли, стук в место человека по полному адресу с провода
// (один раз за сессию: второй join — повтор, не разговор), занятость. Ответ
// один: имя, команда сторожа, ожидавшие кадры, хук, расписка стука. Вызов со
// status на месте, которое мост уже держит, — только занятость (status.ts, #6509).
// Отсутствие тула в сессии — тулы идут мимо моста либо мост старой сборки.
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";

import { ID_PREFIX, tool } from "../delivery/index.ts";
import { scoped, sessionCwd } from "../shared/scope.ts";
import { alive, listens, nameOf, readBoard } from "./board.ts";
import {
  type AskedHearing,
  besideRefusal,
  callTool as call,
  leadsOtherPlace,
  otherPlaceWord,
  serialized,
  short,
  unresolvedRefusal,
} from "./call.ts";
import { CFG } from "./config.ts";
import { wireEviction } from "./evicted.ts";
import { seatField } from "./fields.ts";
import {
  askedHearing,
  boardHearing,
  ledHere,
  ofSeat,
  seatKarta,
  seatRealm,
  unresolvedAgent,
} from "./hearing.ts";
import {
  awaitHello,
  doors,
  hasStatusAddressFor,
  heldKey,
  holdsStanding,
  isParked,
  ledKey,
  noteStandCwd,
  standingIdIn,
  wasEvicted,
} from "./hold.ts";
import { keyOf, noteSeatBase } from "./holdrecord.ts";
import { armRoleHook } from "./hook.ts";
import { knock, resetKnocks } from "./knock.ts";
import { heardOnReturn, returnToStanding } from "./leave.ts";
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
import { ownerRefusal } from "./owner.ts";
import { placeFields, rememberModel } from "./placefields.ts";
import { otherRealm } from "./realms.ts";
import { resumeFromDisk, takeLapsed } from "./resume.ts";
import { resumeWords } from "./resumewords.ts";
import { SATELLITE_TTL_S, satelliteGate, satelliteListenWord, ttlRefused } from "./satellite.ts";
import { baseOf, type Resumed, seatFor, theirsByRecord } from "./separate.ts";
import { SW } from "./standwords.ts";
import { busyLine, publishStatus, standStatusOnly, TAKE_PATH, TURNED_GUIDANCE } from "./status.ts";
import { state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";
import { readLatest, staleNotice } from "./update.ts";

/** Повтор вызова после отказанного возврата на оставленное место — один. */
const R = scoped(() => ({ again: false }));

/** Имя места, которое ведёт мост, — для совета в отказе «стояние одно на мост». */
const ledName = (): string => state.standing?.name ?? "";

const isDirectory = (p: string): boolean => {
  try {
    return isAbsolute(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
};

export const isStandCall = (msg: JsonRpcMessage): boolean =>
  msg?.method === "tools/call" && msg?.params?.name === tool("stand");

/** Место отняли (evicted.ts, #6706): встать рядом на имя.N тем же ходом, что iskron_stand с этим именем. */
wireEviction(async (place, cwd) => {
  const r = await serialized(() =>
    runStand({
      jsonrpc: "2.0",
      id: `${ID_PREFIX}bridge-evicted`,
      method: "tools/call",
      params: {
        name: tool("stand"),
        arguments: {
          realm: place.realm,
          karta: String(place.karta),
          name: baseOf(place.realm, place.karta, place.name ?? ""), // основа, от которой место выбрано (#6706)
          ...(cwd && isDirectory(cwd) ? { cwd } : {}),
        },
      },
    }),
  );
  const text = ((r.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "");
  return { ok: !r.result?.isError, text: text.join("\n") };
});

export async function runStand(msg: JsonRpcMessage): Promise<JsonRpcMessage> {
  // Занятость на месте, которое мост уже держит, — только строка (#6509).
  const statusOnly = await standStatusOnly(msg);
  if ("reply" in statusOnly) return statusOnly.reply;
  const a = msg.params?.arguments ?? {};
  let realm = typeof a.realm === "string" ? a.realm.trim() : "";
  let karta = a.karta != null ? normKarta(a.karta) : "";
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
    lines.push(SW.needRealmKarta(statusOnly.miss, statusOnly.of));
    return done(true);
  }
  const model = typeof a.model === "string" && a.model.trim() ? a.model : undefined;
  rememberModel(model);
  // Каталог по умолчанию — моста харнеса: у сессии демона это cwd тонкого моста, не демона.
  const cwd = typeof a.cwd === "string" && a.cwd.trim() ? a.cwd.trim() : sessionCwd();
  // Кривой cwd адресовал бы другое место (репо из несуществующего или чужого
  // каталога) — отказ вслух, как у явного имени (#5068).
  if (cwd !== sessionCwd() && !isDirectory(cwd)) {
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
  // Роль владельца (主) — только словом человека (owner.ts, #6550 п.2).
  const notOwner = await ownerRefusal(realm, karta);
  if (notOwner) {
    lines.push(notOwner);
    return done(true);
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
  const base = sat ? "" : name; // основа места рядом: выведенное или явное имя (#6706)
  realm = await seatRealm(realm, name); // одна форма графа (#5838), своё место — под своим написанием (hearing.ts)
  karta = seatKarta(realm, karta, name); // «agent» — роль своего места, до любой проверки (hearing.ts)
  // Мост уже стоит на отдельном месте этого имени — туда же (#5407); take=true зовёт само имя.
  const led0 = state.standing && !otherRealm(state.standing.realm, realm) ? state.standing : null;
  // Основу места рядом мост помнит сам (#6706); по виду имени её не угадать — glm-5.3 не место рядом glm-5.
  const ledSuffix =
    !!base &&
    !!led0 &&
    String(led0.karta) === String(karta) &&
    led0.name !== base &&
    baseOf(led0.realm, led0.karta, led0.name ?? "") === base;
  // Отнятое место рядом — не возврат: следующее место рядом выбирает seatFor (#6706).
  const besideTaken = ledSuffix && !!led0 && wasEvicted(led0.realm, led0.karta, led0.name ?? "");
  if (ledSuffix && !besideTaken && a.take !== true) name = led0?.name ?? name;
  if (parts && fitted && fitted.cut.length) {
    const what = fitted.cut.map(SW.cutPart).join(", ");
    nameNotes.push(SW.nameCut(joinName(parts), NAME_MAX, name, what));
  }
  if (!asked && !sat && !model) nameNotes.push(SW.noModel());
  const room = typeof a.room === "string" && a.room.trim() ? a.room.trim() : null;
  // Стояние одно на мост (#5154): другое место при ведомом своём — только по
  // явному take=true; иначе отказ вслух, и ничего не тронуто.
  // Имя графа, не разрешённое в @owner/slug, против графов своих мест — отказ, не догадка (#5838);
  // так же роль-сентинел, не разрешённая в число (hearing.ts).
  const unresolved = unresolvedRefusal(realm) ?? unresolvedAgent(karta, "connect");
  if (unresolved) {
    lines.push(unresolved);
    return done(true);
  }
  const led = besideTaken ? null : leadsOtherPlace(realm, karta, name);
  if (led && a.take !== true) {
    // Просимое место слушает другая сессия — take=true не советуется: вытеснить её — словом человека (#6706).
    // Доска не прочлась — мост не знает, кто слушает, и take=true не советует тоже.
    const hearing = await askedHearing(realm, karta, name, cwd);
    lines.push(otherPlaceWord(led, keyOf(realm, karta, name), name === ledName(), hearing));
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
    call(tool("channel"), { action: "register", realm, karta, name, ...here() });

  // 1. Доска — до любой перемены.
  const board = await call(tool("channel"), { action: "list", realm });
  if (board.isError) {
    lines.push(SW.boardUnread(short(board.text)));
    return done(true);
  }
  // Доска — поля или проза сервера (board.ts, #4514). Управляющие действия — ротация,
  // стук, хук — идут только по распознанной однозначной форме; иначе честный отказ.
  const bd = readBoard(board);
  const { entries, recognized, declared } = bd;
  let own = entries.filter((e) => ofSeat(e, karta, name));
  // Счёт в шапке не сошёлся с разобранным — кто слушает, мост не знает (hearing.ts):
  // вслепую не ротирует, а явный take=true — слово делателя.
  const unread = declared != null && declared !== entries.length;
  const hearing = (n: string): AskedHearing => boardHearing(bd, karta, n);
  if (!recognized || own.length > 1 || (hearing(name) === "unknown" && a.take !== true)) {
    lines.push(
      !recognized
        ? SW.boardUnknown(short(board.text, 160))
        : own.length > 1
          ? SW.boardAmbiguous(own.length, name, karta)
          : SW.boardCount(declared ?? 0, entries.length),
    );
    return done(true);
  }
  // Имя держит прежний мост этой сессии — своё, возвращается сам; другая сессия —
  // встаём рядом на имя.N со слухом; чужим местом не подписываемся (#6706).
  let ownSession = false;
  let byRecord: Resumed | null = null; // своё место, возвращённое по записи держания (seatFor)
  // Основа места рядом: явное имя места рядом — его основа, не base.N.N; выведенное — само себе основа (#6706).
  const root = !base ? "" : asked ? baseOf(realm, karta, base) : base;
  // Место другого графа встаёт register, а он слуха не отнимает: take=true там не берёт чужого — место выбирается так же.
  if (base && (a.take !== true || beside) && name === base) {
    const seat = await seatFor(realm, karta, base, hearing, beside, cwd, root);
    const choice = seat.choice;
    byRecord = seat.resumed;
    if ("refusal" in choice) {
      lines.push(choice.refusal);
      return done(true);
    }
    name = choice.name;
    ownSession = choice.own;
    own = entries.filter((e) => ofSeat(e, karta, name));
    if (own.length > 1) {
      lines.push(SW.boardAmbiguous(own.length, name, karta));
      return done(true);
    }
    if (choice.note) nameNotes.push(choice.note);
  }
  // До connect: основа этого выбора — в запись и файл основы; прежняя основа имени его не переживает (#6706).
  if (base) noteSeatBase(keyOf(realm, karta, name), root);
  const take = a.take === true || ownSession;
  const sub = !!sat || baseOf(realm, karta, name) !== name; // место рядом и спутник: хук инбокса роли не взводится
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
    return branches.has(third) && alive(e);
  });
  for (const e of legacy) nameNotes.push(SW.legacy(e.address, realm, karta));
  if (unread) lines.push(SW.boardCountFound(declared ?? 0, entries.length));
  const mine = own[0];
  let incoming = mine?.incoming ?? null;

  // 2. Место. Свой сокет держит этот мост — register. Место другой сессии сюда
  // не доходит — выше выбрано место рядом (#6706); своё место прежнего моста этой
  // сессии — connect, как по take. Иначе connect и register; новый сокет — новый
  // цикл входа, счёт стуков сброшен.
  let how: string;
  let heardHere: boolean;
  // Своё место, чей сокет мост сейчас переоткрывает сам (не отъём): доска ещё читает его слушающим — это он.
  const reopening = !sat && !holdsStanding(realm, karta, name) && ledHere(realm, karta, name);
  const listensElsewhere =
    !!mine && listens(mine) && !holdsStanding(realm, karta, name) && !reopening;
  // Мост поднят заново под местом, которое держал прежний мост этого каталога
  // (перезапуск плагина, /mcp reconnect): место возвращается с диска, не
  // ротируется — адрес, хуки и очередь те же (#5061). Доска ещё читает
  // «слушает» (окно платформы после смерти прежнего моста) — возврат уже выше,
  // только по записи, со слухом (seatFor); подписи без слуха нет (#6706).
  // Спутник с диска не возвращается: его место живёт прогоном (satellite.ts).
  // Запись другой названной сессии — её место: с диска его возвращает только её мост (#6706).
  const fresh =
    !sat &&
    !take &&
    !reopening &&
    !holdsStanding(realm, karta, name) &&
    !isParked(realm, karta, name) &&
    !theirsByRecord(keyOf(realm, karta, name));
  const resumed =
    byRecord ?? (fresh && !listensElsewhere ? await resumeFromDisk(realm, karta, name) : null);
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
  } else if (!take && isParked(realm, karta, name) && returnToStanding("iskron_stand")) {
    // Ушёл с места и вернулся: тот же адрес, сокет открыт заново, register — атрибуция.
    // Адрес за это время повернула другая сессия — сокет отказан и отпущен: место её,
    // подписи им нет — тот же вызов заново выберет место рядом (#6706).
    await heardOnReturn(); // нет hello — адрес мог повернуть другой: сокет отпущен (leave.ts)
    if (!holdsStanding(realm, karta, name) && !R.again) {
      R.again = true;
      try {
        return await runStand(msg);
      } finally {
        R.again = false;
      }
    }
    const r = await register();
    if (r.isError) {
      lines.push(SW.refused("register", short(r.text)));
      return done(true);
    }
    heardHere = true;
    how = SW.howReturned();
  } else if (!take && (holdsStanding(realm, karta, name) || reopening)) {
    const r = await register();
    if (r.isError) {
      lines.push(SW.refused("register", short(r.text)));
      return done(true);
    }
    heardHere = true;
    socketBefore = true;
    how = SW.howRegister();
  } else if (!take && listensElsewhere) {
    // Слушает другой держатель, а места рядом выбрано не было: подписи без слуха нет (#6706).
    lines.push(SW.otherHolder(mine?.address ?? name));
    return done(true);
  } else {
    const args: Record<string, unknown> = { action: "connect", realm, karta, name };
    Object.assign(args, here());
    if (typeof a.mute_siblings === "boolean") args.mute_siblings = a.mute_siblings;
    if (sat) args.ttl_seconds = SATELLITE_TTL_S; // приглашения спутнику не переживают прогон (#6001, условие а)
    let c = await call(tool("channel"), args); // новый сокет держатель берёт сам и заново: кольцо кадров чистое
    if (sat && c.isError && ttlRefused(c)) {
      // Разброс окна держит контур; вне его — место всё же нужно прогону, окно — умолчание контура.
      extra.push(SW.ttlRefused(SATELLITE_TTL_S, short(c.text, 120)));
      delete args.ttl_seconds;
      c = await call(tool("channel"), args);
    }
    if (c.isError) {
      lines.push(SW.refused("connect", short(c.text)));
      return done(true);
    }
    incoming =
      seatField(c.structured, "connect")?.inbound ??
      /https?:\/\/\S+\/channel\/in\/\S+/.exec(c.text)?.[0] ??
      incoming;
    const r = await register();
    if (r.isError) {
      lines.push(SW.takenButRegister(short(r.text)));
      return done(true);
    }
    resetKnocks(realm, karta, name);
    heardHere = true;
    how = ownSession
      ? SW.howOwnSession()
      : SW.howConnect(!!mine, listensElsewhere, a.take === true);
    // Место занято заново после возврата, не нашедшего записи: дела могли пропасть (#6649).
    if (takeLapsed()) extra.push(`[iskron_stand] ${resumeWords.rejoin()}`);
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
  if (!heardHere) lines.push(SW.besideNoDoor());
  else if (beside) lines.push(SW.besideHeard());
  else if (socketBefore) lines.push(SW.heldAlready());
  else {
    const hello = await awaitHello(4000);
    lines.push(hello ? SW.hello(String(hello.pending ?? 0)) : SW.noHello());
  }
  // Сокет службы есть, а локальный для сторожа не поднялся — слуха нет, скажи это.
  const localFault = heardHere
    ? (doors().find((d) => d.key === heldKey(realm))?.listenError ?? null)
    : null;
  if (localFault) lines.push(SW.noLocalSocket(localFault));

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

  // 5. Стук в место человека — по полному адресу с провода (knock.ts, #4342).
  if (room && !heardHere) {
    lines.push(SW.knockNotHere(room));
  } else if (room) {
    const onBoard = entries.find((e) => e.address === room);
    const roomKarta =
      onBoard?.karta ??
      (typeof a.room_karta === "string" && a.room_karta.trim()
        ? a.room_karta.trim().replace(/^#/, "")
        : null);
    lines.push(
      await knock({ realm, karta, name, room, roomKarta, again: a.repeat_knock === true }),
    );
  }

  // 6. Занятость — от стояния, которое ведёт мост, не от живого сокета (#5033):
  // и после вытеснения, пока статусный адрес у моста.
  if (typeof a.status === "string" && a.status.trim() && !hasStatusAddressFor(realm, karta, name)) {
    lines.push(SW.statusElsewhere(TAKE_PATH()));
  } else if (typeof a.status === "string" && a.status.trim()) {
    const st = await publishStatus(a.status.trim(), realm);
    lines.push(
      st.ok
        ? busyLine(a.status.trim(), realm)
        : SW.statusRefused(short(st.body), st.code === 404 ? ` ${TURNED_GUIDANCE()}` : ""),
    );
  }
  const stale = staleNotice(readLatest(CFG.authDir), CFG.authDir);
  if (stale) lines.push(stale);
  return done();
}
