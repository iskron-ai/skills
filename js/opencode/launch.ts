// Строка запуска с делом в OpenCode (разбор и вход — shared/launch.ts): дочерняя
// сессия встаёт спутником места корня в названной роли (satellite.ts) — корень
// места не держит, своим местом. Хвост «от <место>» здесь лишний: родитель
// известен плагину, и спутник встаёт по месту корня.
import { enterCase, parseLaunch } from "../shared/launch.ts";
import { type Place } from "./satellite.ts";

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
      // satellite_of подставляет сам вызов (asSatellite в tools.ts) — по месту корня.
      return enterCase(
        l,
        (name, args) => d.call(slot, name, args, sessionID),
        null,
        () => slot.place?.name,
      );
    },
  };
}
