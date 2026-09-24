// Мост-спутник — своё место субагента (граф nks-dev: #6002, условия
// архитектора в #6001). Claude Code поднимает MCP-сервер из фронтматтера файла
// агента отдельным соединением на прогон субагента; такой мост, запущенный с
// --satellite (или ISKRON_BRIDGE_SATELLITE=1), занимает только место-спутник
// рядом с местом позвавшего: имя `<место позвавшего>.sub-<N>` с первым
// свободным на доске N, роль позвавшего, без хука инбокса роли, канал с
// коротким окном простоя, без записи держания; с концом прогона (stdin закрыт)
// мост уходит с места, и канал гаснет по окну (main.ts).
import { type BoardEntry, nameOf, parseBoard } from "./board.ts";
import { callTool as call, short } from "./call.ts";
import { CFG } from "./config.ts";
import { NAME_MAX, nameFault, normKarta } from "./names.ts";
import { noteSatelliteOf } from "./placefields.ts";
import { otherRealm } from "./realms.ts";
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
  { ok: true; name: string; caller: string; notes: string[] } | { ok: false; refusal: string };

/**
 * Место-спутник по доске: место позвавшего (`@handle:name` либо голое имя)
 * должно стоять на доске под той же ролью; имя — первое `.sub-N`, которого на
 * доске нет вовсе. `led` — имя места, которое этот мост уже ведёт в графе:
 * спутник той же базы возвращается на него, а не берёт следующий номер.
 */
export function pickSatellite(
  entries: BoardEntry[],
  of: string,
  karta: string,
  led: string | null,
): SatellitePick {
  const address = of.startsWith("@") && of.includes(":") ? of : null;
  const base = address ? nameOf(address) : of.replace(/^@/, "");
  const fault = base ? nameFault(base) : "пусто";
  if (fault)
    return {
      ok: false,
      refusal: `Отказано (мост): satellite_of «${of}» — не имя места (${fault}); передай место позвавшего как печатает доска: @handle:name.`,
    };
  const callers = entries.filter((e) =>
    address ? e.address === address : nameOf(e.address) === base,
  );
  if (!callers.length)
    return {
      ok: false,
      refusal: `Отказано (мост): места позвавшего ${of} на доске этого графа нет — спутнику не к чему встать рядом; проверь satellite_of и граф в постановке.`,
    };
  const same = callers.filter((e) => e.karta === normKarta(karta));
  if (!same.length)
    return {
      ok: false,
      refusal: `Отказано (мост): место позвавшего ${callers[0].address} держит роль #${callers[0].karta}, а не #${normKarta(karta)} — спутник действует в мандате позвавшего, его ролью.`,
    };
  if (same.length > 1)
    return {
      ok: false,
      refusal: `Отказано (мост): имя ${base} у роли #${normKarta(karta)} носят ${same.length} места — передай satellite_of полным адресом @handle:name.`,
    };
  const caller = same[0].address;
  const notes: string[] = [];
  if (led && isSatelliteOf(base, led)) return { ok: true, name: led, caller, notes };
  const taken = new Set(entries.map((e) => nameOf(e.address)));
  for (let n = 1; n <= 99; n++) {
    const name = satelliteName(base, n);
    if (taken.has(name)) continue;
    if (!name.startsWith(`${base}.`))
      notes.push(
        `имя ${base}.sub-${n} длиннее предела ${NAME_MAX} знаков — база укорочена: ${name}`,
      );
    return { ok: true, name, caller, notes };
  }
  return {
    ok: false,
    refusal: `Отказано (мост): у места ${caller} заняты все спутники .sub-1…99 — прибери погасшие места прежних прогонов.`,
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
      "Отказано (мост): это мост-спутник — он занимает только место-спутник субагента; передай satellite_of — место позвавшего (@handle:name) из постановки.",
    );
  if (!of) return null;
  if (!CFG.satellite)
    return refuse(
      "Отказано (мост): satellite_of — только мосту-спутнику (запись моста с --satellite в файле агента); этот мост — мост сессии, и место-спутник на нём заняло бы голос позвавшего. Субагенту без своего моста — предел: он говорит местом позвавшего и называет себя в своих строках.",
    );
  if (asked || a.take === true || (typeof a.room === "string" && a.room.trim()))
    return refuse(
      "Отказано (мост): имя спутника выводит мост — name, take и room вместе с satellite_of не передаются.",
    );
  const b = await call("iskron_channel", { action: "list", realm });
  if (b.isError) return refuse(`Отказано: доска не прочиталась — ${short(b.text)}`);
  const s = state.standing;
  const led = s && !otherRealm(s.realm, realm) ? (s.name ?? null) : null;
  const pick = pickSatellite(parseBoard(b.text), of, karta, led);
  if (!pick.ok) return pick;
  noteSatelliteOf(pick.caller);
  pick.notes.push(
    `место-спутник ${pick.caller}: роль позвавшего, хука инбокса роли нет, окно простоя канала ${SATELLITE_TTL_S} с, записи держания нет — место живёт прогоном`,
  );
  return pick;
}

/** Слово о слухе вместо команды сторожа: спутник сторожа не держит. */
export const satelliteListenWord = (): string =>
  `[iskron-bridge] Место-спутник: сторожа не взводи — место живёт прогоном субагента и подписывает его записи; ` +
  `с концом прогона мост уходит с места сам, канал гаснет окном простоя ${SATELLITE_TTL_S} с. ` +
  `Первый ход — вход в дело, названное постановкой, и пересказ постановки первым словом в нём.`;
