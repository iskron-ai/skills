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
  /** Ребёнок кончен: мост гасится forget, затем сессия помечена; of — место корня. */
  end(session: string, of: Place | null | undefined, forget: (s: string) => void): void;
  /** Ребёнок встал заново либо сессия удалена — пометка снята. */
  clear(session: string): void;
  /** Бросает отказ вслух, если вызов кончившегося ребёнка не только читает. */
  guard(session: string, name: string, args: Record<string, unknown>): void;
}

export function createRunEnds(): RunEnds {
  const ended = new Map<string, Place | null>();
  return {
    end(session, of, forget) {
      forget(session);
      ended.set(session, of ?? null);
    },
    clear: (session) => void ended.delete(session),
    guard(session, name, args) {
      if (!ended.has(session) || name === STAND_TOOL || READ_TOOLS.has(name)) return;
      const action = String(args.action ?? "");
      if (action === "?" || READ_ACTIONS[name]?.has(action)) return;
      const of = ended.get(session)?.name ?? "<место запустившего>";
      throw new Error(
        `Отказано (плагин): эта дочерняя сессия кончена, её место-спутник отпущено — ` +
          `${name}${action ? ` (${action})` : ""} пошёл бы мостом и местом запустившего. Встань заново: ` +
          `iskron_stand(realm, karta, satellite_of="${of}"), затем повтори вызов.`,
      );
    },
  };
}
