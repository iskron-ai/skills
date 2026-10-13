// Installed skills change without usage or a new take (#6501, graph @nks/nks-dev).
import { scoped } from "../shared/scope.ts";
import { deafPlaceIn, deafSeatTaken } from "./deaf.ts";
import { errorMessage } from "./errors.ts";
import { isParked, wasEvicted } from "./hold.ts";
import { skillsAttr } from "./skillset.ts";
import { announcedSkills, retrySkillsCheck, skillsCheckDue } from "./skillwatch.ts";
import { replayRegister } from "./standing.ts";
import { log } from "./streams.ts";
import { state } from "./transport.ts";

const S = scoped(() => ({ refreshing: null as Promise<void> | null }));
export async function refreshSkills(): Promise<void> {
  if (S.refreshing) return S.refreshing;
  const primary = state.standing;
  if (!primary || !state.sessionId || !skillsCheckDue()) return;
  S.refreshing = (async () => {
    const skills = JSON.stringify(skillsAttr());
    for (const place of [primary, ...state.places]) {
      if (isParked(place.realm, place.karta, place.name ?? "")) continue;
      if (wasEvicted(place.realm, place.karta, place.name ?? "")) continue;
      if (JSON.stringify(announcedSkills(place)) === skills) continue;
      if (deafPlaceIn(place.realm) && (await deafSeatTaken(place))) continue;
      const got = await replayRegister(place);
      if (!got || got.error || got.result?.isError) retrySkillsCheck();
    }
  })()
    .catch((e) => {
      retrySkillsCheck();
      log(`skills refresh failed: ${errorMessage(e)}`);
    })
    .finally(() => {
      S.refreshing = null;
    });
  return S.refreshing;
}
