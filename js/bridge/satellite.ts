// Мост-спутник — своё место субагента (граф nks-dev: #6002, условия
// архитектора в #6001). Claude Code поднимает MCP-сервер из фронтматтера файла
// агента отдельным соединением на прогон субагента; такой мост, запущенный с
// --satellite (только флагом), занимает только место-спутник
// рядом с местом позвавшего: имя `<место позвавшего>.sub-<N>` с первым
// свободным на доске N, роль — названная karta вызова (её называет
// запускающий, наследства роли нет), без хука инбокса роли, канал с
// коротким окном простоя, без записи держания; с концом прогона (stdin закрыт)
// мост уходит с места, и канал гаснет по окну (main.ts).
import { L } from "../shared/lang.ts";
import { type BoardEntry, nameOf, parseBoard } from "./board.ts";
import { callTool as call, short } from "./call.ts";
import { CFG } from "./config.ts";
import { NAME_MAX, nameFault, normKarta } from "./names.ts";
import { noteSatelliteOf } from "./placefields.ts";
import { otherRealm } from "./realms.ts";
import { log } from "./streams.ts";
import { state } from "./transport.ts";

/** Окно простоя канала спутника, с; переменная — шов проб и ручка на случай, если контур сузит разброс. */
export const SATELLITE_TTL_S = Number(process.env.ISKRON_BRIDGE_SATELLITE_TTL) || 300;

const SUB_RE = /\.sub-([1-9]\d*)$/;

/** Имя спутника номер n; не укладывается в предел — база укорачивается с конца. */
export const satelliteName = (base: string, n: number): string =>
  base.slice(0, NAME_MAX - `.sub-${n}`.length).replace(/[-._]+$/, "") + `.sub-${n}`;

/** Своё ли имя-спутник для этой базы (любой номер) — повторный iskron_stand того же прогона возвращается на него. */
export function isSatelliteOf(base: string, name: string): boolean {
  const m = SUB_RE.exec(name);
  return !!m && satelliteName(base, Number(m[1])) === name;
}

export type SatellitePick =
  | {
      ok: true;
      name: string;
      caller: string;
      callerKarta: string;
      callerId: string | null;
      notes: string[];
    }
  | { ok: false; refusal: string };

/**
 * Место-спутник по доске: место позвавшего (`@handle:name` либо голое имя)
 * должно стоять на доске — любой роли: роль спутника — `karta` вызова; имя —
 * первое `.sub-N`, которого на доске нет вовсе. `led` — имя места, которое
 * этот мост уже ведёт в графе: спутник той же базы возвращается на него, а не
 * берёт следующий номер.
 */
export function pickSatellite(
  entries: BoardEntry[],
  of: string,
  karta: string,
  led: string | null,
): SatellitePick {
  const address = of.startsWith("@") && of.includes(":") ? of : null;
  const base = address ? nameOf(address) : of.replace(/^@/, "");
  const fault = base ? nameFault(base) : L("пусто", "empty");
  if (fault)
    return {
      ok: false,
      refusal: L(
        `Отказано (мост): satellite_of «${of}» — не имя места (${fault}); передай место позвавшего как печатает доска: @handle:name.`,
        `Refused (bridge): satellite_of "${of}" is not a seat name (${fault}); pass the caller's seat as the board prints it: @handle:name.`,
      ),
    };
  const callers = entries.filter((e) =>
    address ? e.address === address : nameOf(e.address) === base,
  );
  if (!callers.length)
    return {
      ok: false,
      refusal: L(
        `Отказано (мост): места позвавшего ${of} на доске этого графа нет — спутнику не к чему встать рядом; проверь satellite_of и граф в постановке.`,
        `Refused (bridge): the caller's seat ${of} is not on this graph's board — the satellite has nothing to stand beside; check satellite_of and the graph in the brief.`,
      ),
    };
  // Одно имя у нескольких мест (разные роли) — место своей роли, если оно одно; иначе неоднозначно.
  const same = callers.length > 1 ? callers.filter((e) => e.karta === normKarta(karta)) : callers;
  if (same.length !== 1)
    return {
      ok: false,
      refusal: L(
        `Отказано (мост): имя ${base} на доске носят ${callers.length} места — передай satellite_of полным адресом @handle:name.`,
        `Refused (bridge): ${callers.length} seats on the board carry the name ${base} — pass satellite_of as the full address @handle:name.`,
      ),
    };
  const caller = same[0].address;
  const callerKarta = same[0].karta;
  const callerId = same[0].id;
  const notes: string[] = [];
  if (led && isSatelliteOf(base, led)) {
    // Повтор того же прогона — либо параллельный прогон ТОГО ЖЕ файла агента:
    // Claude Code мемоизует сервер файла агента по имени и конфигу, и второй
    // прогон приходит в этот же мост. Различить их мост не может — называет оба.
    const word = L(
      `мост уже держит ${led} — повтор этого прогона либо параллельный прогон того же файла агента, который делит это место и потеряет его, когда первый закончит; параллельно — не больше одного прогона на файл агента`,
      `the bridge already holds ${led} — a repeat of this run or a parallel run of the same agent file, which shares this seat and loses it when the first one ends; in parallel — no more than one run per agent file`,
    );
    log(word);
    notes.push(word);
    return { ok: true, name: led, caller, callerKarta, callerId, notes };
  }
  const taken = new Set(entries.map((e) => nameOf(e.address)));
  for (let n = 1; n <= 99; n++) {
    const name = satelliteName(base, n);
    if (taken.has(name)) continue;
    if (!name.startsWith(`${base}.`))
      notes.push(
        L(
          `имя ${base}.sub-${n} длиннее предела ${NAME_MAX} знаков — база укорочена: ${name}`,
          `the name ${base}.sub-${n} is longer than the ${NAME_MAX}-sign limit — the base is cut: ${name}`,
        ),
      );
    return { ok: true, name, caller, callerKarta, callerId, notes };
  }
  return {
    ok: false,
    refusal: L(
      `Отказано (мост): у места ${caller} заняты все спутники .sub-1…99 — прибери погасшие места прежних прогонов.`,
      `Refused (bridge): every satellite .sub-1…99 of the seat ${caller} is taken — clear the dead seats of former runs.`,
    ),
  };
}

/**
 * Шаг iskron_stand до вывода имени: спутнику — только место-спутник, мосту
 * сессии — никогда. null — вызов не о спутнике; иначе имя места либо отказ.
 */
export async function satelliteGate(
  a: Record<string, unknown>,
  realm: string,
  karta: string,
  asked: string,
): Promise<SatellitePick | null> {
  const of = typeof a.satellite_of === "string" ? a.satellite_of.trim() : "";
  const refuse = (refusal: string): SatellitePick => ({ ok: false, refusal });
  if (CFG.satellite && !of)
    return refuse(
      L(
        "Отказано (мост): это мост-спутник — он занимает только место-спутник субагента; передай satellite_of — место позвавшего (@handle:name) из постановки.",
        "Refused (bridge): this is a satellite bridge — it takes only a subagent's satellite seat; pass satellite_of — the caller's seat (@handle:name) from the brief.",
      ),
    );
  if (!of) return null;
  if (!CFG.satellite)
    return refuse(
      L(
        "Отказано (мост): satellite_of — только мосту-спутнику (запись моста с --satellite в файле агента); этот мост — мост сессии, и место-спутник на нём заняло бы голос позвавшего. Субагенту без своего моста — предел: он говорит местом позвавшего и называет себя в своих строках.",
        "Refused (bridge): satellite_of is for a satellite bridge only (a bridge entry with --satellite in the agent file); this is a session bridge, and a satellite seat on it would take the caller's voice. A subagent without a bridge of its own has a limit: it speaks as the caller's seat and names itself in its lines.",
      ),
    );
  if (asked || a.take === true || (typeof a.room === "string" && a.room.trim()))
    return refuse(
      L(
        "Отказано (мост): имя спутника выводит мост — name, take и room вместе с satellite_of не передаются.",
        "Refused (bridge): the bridge derives the satellite's name — name, take and room do not go with satellite_of.",
      ),
    );
  const b = await call("iskron_channel", { action: "list", realm });
  if (b.isError)
    return refuse(
      L(
        `Отказано: доска не прочиталась — ${short(b.text)}`,
        `Refused: the board did not read — ${short(b.text)}`,
      ),
    );
  const s = state.standing;
  const led = s && !otherRealm(s.realm, realm) ? (s.name ?? null) : null;
  const pick = pickSatellite(parseBoard(b.text), of, karta, led);
  if (!pick.ok) return pick;
  // id места печатает только доска одной роли (list с karta), последней строкой под местом.
  if (!pick.callerId) {
    const k = await call("iskron_channel", { action: "list", realm, karta: pick.callerKarta });
    if (!k.isError)
      pick.callerId = parseBoard(k.text).find((e) => e.address === pick.caller)?.id ?? null;
  }
  noteSatelliteOf(pick.caller, pick.callerId);
  pick.notes.push(
    L(
      `место-спутник ${pick.caller}: роль #${normKarta(karta)}, хука инбокса роли нет, окно простоя канала ${SATELLITE_TTL_S} с, записи держания нет — место живёт прогоном`,
      `satellite seat of ${pick.caller}: role #${normKarta(karta)}, no role inbox hook, channel idle window ${SATELLITE_TTL_S} s, no holding record — the seat lives by the run`,
    ),
  );
  if (!pick.callerId)
    pick.notes.push(
      L(
        `id места ${pick.caller} доска не напечатала — признак спутника (satellite_of) платформе не послан: место может унаследовать недоставленную почту роли`,
        `the board did not print the id of ${pick.caller} — the satellite sign (satellite_of) was not sent to the platform: the seat may inherit the role's undelivered mail`,
      ),
    );
  return pick;
}

/**
 * Отказ ли connect именно окну простоя: ответ называет ttl либо несёт код 4xx.
 * Разброс окна и слова отказа держит контур — мост не угадывает их формулировку.
 */
export const ttlRefused = (text: string): boolean =>
  /ttl/i.test(text) || /(^|\D)4\d\d(\D|$)/.test(text);

const PLACE_ACTIONS = new Set(["connect", "mint", "register", "revoke"]);

/**
 * Ограда моста-спутника на сыром iskron_channel: connect, mint, register и
 * revoke — только своего места `.sub-N`, и только после iskron_stand. Иначе
 * субагент мог бы взять или снять сокет места позвавшего. null — пропустить.
 */
export function satelliteChannelRefusal(args: Record<string, unknown>): string | null {
  if (!CFG.satellite) return null;
  const action = String(args.action ?? "");
  if (!PLACE_ACTIONS.has(action)) return null;
  const s = state.standing;
  const own = s?.name ?? "";
  if (!s || !SUB_RE.test(own))
    return `Отказано (мост-спутник): ${action} мимо iskron_stand — место этому мосту даёт только iskron_stand с satellite_of; чужое место спутник не берёт и не снимает.`;
  const sameRealm = !otherRealm(args.realm, s.realm);
  const karta = normKarta(args.karta ?? s.karta);
  const target =
    action === "revoke"
      ? args.channel != null
        ? null
        : String(args.standing ?? "")
      : String(args.name ?? "").trim();
  const mine =
    target != null &&
    (target === own || target.endsWith(`:${own}`) || (action === "revoke" && target === "mine"));
  if (sameRealm && karta === normKarta(s.karta) && mine) return null;
  return `Отказано (мост-спутник): ${action} — только своего места ${own} (роль #${normKarta(s.karta)}, граф ${s.realm}); место позвавшего и любое другое спутник не берёт и не снимает.`;
}

/** Слово о слухе вместо команды сторожа: спутник сторожа не держит. */
export const satelliteListenWord = (): string =>
  L(
    `[iskron-bridge] Место-спутник: сторожа не взводи — место живёт прогоном субагента и подписывает его записи; ` +
      `с концом прогона мост уходит с места сам, канал гаснет окном простоя ${SATELLITE_TTL_S} с. ` +
      `Первый ход — вход в дело, названное постановкой, и пересказ постановки первым словом в нём.`,
    `[iskron-bridge] Satellite seat: do not arm a watchdog — the seat lives by the subagent's run and signs its records; ` +
      `when the run ends the bridge leaves the seat itself, the channel dies after the ${SATELLITE_TTL_S} s idle window. ` +
      `The first move — enter the case the brief names and retell the brief as your first message in it.`,
  );
