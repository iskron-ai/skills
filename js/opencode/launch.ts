// Строка запуска с делом (граф nks-dev: #6078): дочерняя сессия, чей первый
// промпт начинается «start <граф> <роль> <дело №N>» (или «#N»), встаёт и входит
// в дело до первого хода модели — это делает плагин, не текст скилла. Встаёт
// спутником места корня в названной роли (satellite.ts); корень места не
// держит — своим местом.
import { type Place, STAND_TOOL } from "./satellite.ts";

/** Что называет строка запуска: граф, роль и дело. */
export interface Launch {
  realm: string;
  karta: string;
  /** Номер дела — цифры, без знака. */
  no: string;
}

// Роль сама пишется «#N», поэтому разбор позиционный: граф, роль, затем дело —
// «дело №N», «дело #N», «case #N» или голое «№N»/«#N».
const LINE = /^start\s+(\S+)\s+(\S+)\s+(?:(?:дело|case)\s+)?[№#]\s?(\d+)(?=\s|$)/iu;

/** Строка запуска с делом в начале текста; нет её — null (прежнее поведение). */
export function parseLaunch(text: string): Launch | null {
  const [, realm, karta, no] = LINE.exec(text.trimStart()) ?? [];
  return realm && karta && no ? { realm, karta, no } : null;
}

/** Слово плагина ставится сразу за строкой запуска — первым, что прочтёт модель после неё. */
export function withWord(text: string, word: string): string {
  const body = text.trimStart();
  const nl = body.indexOf("\n");
  return nl < 0 ? `${body}\n${word}` : `${body.slice(0, nl)}\n${word}${body.slice(nl)}`;
}

export interface LaunchDoors<S extends { place?: Place | null }> {
  rootOf(sessionID: string): Promise<string>;
  /** Мост дочерней сессии для её собственного стояния — спутник места корня, если оно есть. */
  childSlot(sessionID: string, root: string): S;
  /** Вызов тула мостом слота от имени сессии; отказ — бросок с его словами. */
  call(slot: S, name: string, args: Record<string, unknown>, sessionID: string): Promise<string>;
}

export interface Launcher {
  /** Первый промпт сессии: слово в сессию, либо null — не тот случай. */
  launch(sessionID: string, text: string): Promise<string | null>;
  forget(sessionID: string): void;
}

export function createLauncher<S extends { place?: Place | null }>(d: LaunchDoors<S>): Launcher {
  /** Сессии, чей первый промпт уже прошёл, — строка запуска исполняется только в первом. */
  const prompted = new Set<string>();
  return {
    forget: (id) => void prompted.delete(id),
    async launch(sessionID, text) {
      if (prompted.has(sessionID)) return null;
      prompted.add(sessionID);
      const l = parseLaunch(text);
      if (!l) return null;
      const root = await d.rootOf(sessionID);
      if (root === sessionID) return null; // корень входит в дело по скиллу двери
      const slot = d.childSlot(sessionID, root);
      const room = `#${l.no}`; // «№» api пока не принимает
      try {
        await d.call(slot, STAND_TOOL, { realm: l.realm, karta: l.karta }, sessionID);
      } catch (e) {
        return (
          `Искрон: строка запуска — не встал: ${(e as Error).message}. ` +
          `Встань сам (iskron_stand) и войди в дело №${l.no}: iskron_case(action="join", room="${room}").`
        );
      }
      const place = slot.place?.name ?? "своим местом";
      try {
        await d.call(slot, "iskron_case", { action: "join", realm: l.realm, room }, sessionID);
      } catch (e) {
        return `Искрон: встал ${place}; в дело №${l.no} не вошёл — ${(e as Error).message}. Место остаётся.`;
      }
      return `Искрон: встал ${place}, вошёл в дело №${l.no} — первым словом перескажи бриф в деле.`;
    },
  };
}
