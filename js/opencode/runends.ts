// Кончившиеся дочерние сессии (граф nks-dev: #6361, #6625): мост ребёнка погашен
// вместе с местом-спутником — его явным концом (leads.ts) либо остановкой прежнего
// экземпляра плагина, — и без пометки его следующий вызов ушёл бы мостом корня:
// запись подписалась бы местом запустившего, а leave дела вывел бы из дела его
// самого. Пометка живёт в памяти плагина до нового iskron_stand либо до удаления сессии.
import { type Place, STAND_TOOL } from "./satellite.ts";

/** Тулы, которые кончившийся ребёнок ведёт мостом корня целиком: только читают. */
const READ_TOOLS = new Set([
  "iskron_look",
  "iskron_orient",
  "iskron_search",
  "iskron_semantic_search",
]);

/**
 * Читающие действия тулов, у которых есть и пишущие: они ничего не подписывают
 * и идут мостом корня. Прочие действия этих тулов, как и записи графа и дело, — отказ.
 * invert у истории считается пишущим: его смысл по описанию тула не различён.
 */
const READ_ACTIONS: Record<string, Set<string>> = {
  iskron_channel: new Set(["list"]),
  iskron_realm: new Set(["list"]),
  iskron_org: new Set(["list", "get", "realms", "list_members", "list_grants"]),
  iskron_me: new Set(["whoami", "orgs", "kartas", "usage"]),
  iskron_history: new Set(["realm", "node", "delta"]),
};

export interface RunEnds {
  /** Ребёнок кончен: мост гасится forget, затем сессия помечена; of — место корня; final — отпущен запустившим; why — своё слово отказа. */
  end(
    session: string,
    of: Place | null | undefined,
    forget: (s: string) => void,
    final?: boolean,
    why?: string,
  ): void;
  /** Ребёнок встал заново — пометка снята; отпущенного запустившим снимает только удаление сессии (gone). */
  clear(session: string, gone?: boolean): void;
  /** Бросает отказ вслух, если вызов кончившегося ребёнка не только читает. */
  guard(session: string, name: string, args: Record<string, unknown>): void;
}

export function createRunEnds(): RunEnds {
  const ended = new Map<string, Place | null>();
  const released = new Set<string>(); // revoke запустившего окончателен (#6625): встать снова нельзя
  const whys = new Map<string, string>();
  return {
    end(session, of, forget, final = false, why) {
      forget(session);
      ended.set(session, of ?? null);
      if (final) released.add(session);
      if (why) whys.set(session, why);
    },
    clear(session, gone = false) {
      if (gone) released.delete(session);
      if (!released.has(session)) ended.delete(session);
      if (!ended.has(session)) whys.delete(session);
    },
    guard(session, name, args) {
      if (
        released.has(session) &&
        !READ_TOOLS.has(name) &&
        !READ_ACTIONS[name]?.has(String(args.action ?? ""))
      )
        throw new Error(
          `Отказано (плагин): запустивший отпустил эту дочернюю сессию — поручение кончено, место снято; ` +
            `${name} не пойдёт ни её местом, ни местом запустившего, и встать снова нельзя.`,
        );
      if (!ended.has(session) || name === STAND_TOOL || READ_TOOLS.has(name)) return;
      const action = String(args.action ?? "");
      if (action === "?" || READ_ACTIONS[name]?.has(action)) return;
      const of = ended.get(session)?.name ?? "<место запустившего>";
      throw new Error(
        `Отказано (плагин): ${whys.get(session) ?? "эта дочерняя сессия кончена, её место-спутник отпущено"} — ` +
          `${name}${action ? ` (${action})` : ""} пошёл бы мостом и местом запустившего. Встань заново: ` +
          `iskron_stand(realm, karta, satellite_of="${of}"), затем повтори вызов.`,
      );
    },
  };
}
