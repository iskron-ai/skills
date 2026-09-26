// Строка запуска с делом (граф nks-dev: #6078): агент, чей первый промпт
// начинается «start <граф> <роль> <дело №N> [от <место>]», встаёт и входит в
// дело до первого хода модели — это делает харнес (плагин OpenCode, расширение
// pi), не текст скилла. Хвост «от <место>» называет место запустившего там, где
// харнес сам родителя не знает (pi); в OpenCode родитель известен и хвост лишний.
// По-английски: «start <graph> <role> <case №N> [from <seat>]»; слово о входе —
// на языке поставки (shared/lang.ts).
import { L } from "./lang.ts";

/** Что называет строка запуска: граф, роль, дело и, может быть, место запустившего. */
export interface Launch {
  realm: string;
  karta: string;
  /** Номер дела — цифры, без знака. */
  no: string;
  /** Место запустившего (@handle:name) из хвоста «от …»; нет хвоста — null. */
  of: string | null;
}

// Роль сама пишется «#N», поэтому разбор позиционный: граф, роль, затем дело —
// «дело №N», «дело #N», «case #N» или голое «№N»/«#N»; хвост — «от/from @handle:name».
const LINE =
  /^start\s+(\S+)\s+(\S+)\s+(?:(?:дело|case)\s+)?[№#]\s?(\d+)(?:\s+(?:от|from)\s+(@\S+))?(?=\s|$)/iu;

/** Строка запуска с делом в начале текста; нет её — null (прежнее поведение). */
export function parseLaunch(text: string): Launch | null {
  const [, realm, karta, no, of] = LINE.exec(text.trimStart()) ?? [];
  return realm && karta && no ? { realm, karta, no, of: of ?? null } : null;
}

/** Слово харнеса ставится сразу за строкой запуска — первым, что прочтёт модель после неё. */
export function withWord(text: string, word: string): string {
  const body = text.trimStart();
  const nl = body.indexOf("\n");
  return nl < 0 ? `${body}\n${word}` : `${body.slice(0, nl)}\n${word}${body.slice(nl)}`;
}

/** Вызов тула от имени агента; отказ — бросок с его словами. */
export type LaunchCall = (name: string, args: Record<string, unknown>) => Promise<string>;

/**
 * Встать и войти в дело: iskron_stand (с satellite_of, когда место запустившего
 * названо), затем iskron_case join с room «#N» — «№» api пока не принимает.
 * Ответ — слово в сессию; отказ join место не снимает.
 */
export async function enterCase(
  l: Launch,
  call: LaunchCall,
  satelliteOf: string | null,
  placeName: () => string | null | undefined,
): Promise<string> {
  const room = `#${l.no}`;
  const stand: Record<string, unknown> = { realm: l.realm, karta: l.karta };
  if (satelliteOf) stand.satellite_of = satelliteOf;
  try {
    await call("iskron_stand", stand);
  } catch (e) {
    const why = (e as Error).message;
    const join = `iskron_case(action="join", room="${room}")`;
    return L(
      `Искрон: строка запуска — не встал: ${why}. Встань сам (iskron_stand) и войди в дело №${l.no}: ${join}.`,
      `Iskron: launch line — not seated: ${why}. Take your seat yourself (iskron_stand) and enter case №${l.no}: ${join}.`,
    );
  }
  const place = placeName() || L("своим местом", "in a seat of its own");
  try {
    await call("iskron_case", { action: "join", realm: l.realm, room });
  } catch (e) {
    const why = (e as Error).message;
    return L(
      `Искрон: встал ${place}; в дело №${l.no} не вошёл — ${why}. Место остаётся.`,
      `Iskron: seated ${place}; did not enter case №${l.no} — ${why}. The seat stays.`,
    );
  }
  return L(
    `Искрон: встал ${place}, вошёл в дело №${l.no} — первым словом перескажи бриф в деле.`,
    `Iskron: seated ${place}, entered case №${l.no} — retell the brief as your first message in the case.`,
  );
}
