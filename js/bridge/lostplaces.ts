// Места сессии глазами тонкого моста (thin.ts) и их потеря при смене демона.
// Места — ключ → граф, как его назвал агент: основное — по уведомлению held,
// рядом в других графах — по beside (снятое — beside-gone). Место не вернулось в
// новой сессии — агенту уведомлением lost сейчас и отказом каждого вызова тула в
// его граф (и в граф, которого мост заведомо не держит: другое написание, без
// графа), кроме iskron_stand, пока место с тем же ключом не взято снова; у
// спутника — любое место-спутник того же графа (имя .sub-N выбирает мост).
import { L } from "../shared/lang.ts";
import { type JsonRpcMessage } from "./types.ts";

/** Слово сессии о месте, которое она держит или отпустила (hold.ts, places.ts). */
export function placeWord(
  msg: JsonRpcMessage,
): { kind: string; key?: string; realm: string } | null {
  if (msg.method !== "notifications/message" || msg.params?.logger !== "iskron-channel")
    return null;
  const data = msg.params?.data as
    { kind?: unknown; key?: unknown; place?: { realm?: unknown } } | undefined;
  const realm = typeof data?.place?.realm === "string" ? data.place.realm.trim() : "";
  return typeof data?.kind === "string"
    ? { kind: data.kind, key: typeof data.key === "string" ? data.key : undefined, realm }
    : null;
}

export function lostPlaces(say: (m: JsonRpcMessage) => void, log: (m: string) => void) {
  const live = new Map<string, string>();
  const lost = new Map<string, { realm: string; satellite: boolean; text: string }>();
  return {
    live,
    /** Место снова взято (held, beside) — отказ по нему снят. */
    regained(k: string, realm: string): void {
      live.set(k, realm);
      for (const [lk, e] of lost)
        if (lk === k || (e.satellite && e.realm === realm)) lost.delete(lk);
    },
    lose(k: string, realm: string, why: string, satellite: boolean): void {
      const text = satellite
        ? L(
            `Отказано (мост): место спутника потеряно при смене демона машины (${k}) — у места спутника нет записи держания, и записи легли бы без автора; вызов не отправлен. Встань снова: iskron_stand с satellite_of.`,
            `Refused (bridge): the satellite's seat was lost in the machine daemon's change (${k}) — a satellite seat has no holding record, and writes would go unattributed; the call was not sent. Stand again: iskron_stand with satellite_of.`,
          )
        : L(
            `Отказано (мост): место ${k} (граф ${realm}) не вернулось после смены демона машины (${why}) — записи легли бы без автора; вызов не отправлен. Верни место: iskron_stand в этом графе тем же именем.`,
            `Refused (bridge): the seat ${k} (graph ${realm}) did not come back after the machine daemon's change (${why}) — writes would go unattributed; the call was not sent. Bring it back: iskron_stand in that graph with the same name.`,
          );
      lost.set(k, { realm, satellite, text });
      live.delete(k);
      log(text);
      say({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: {
          level: "warning",
          logger: "iskron-channel",
          data: { kind: "lost", key: k, text },
        },
      });
    },
    /** Отказ вызова тула из-за потерянного места; null — пропустить. */
    refusal(msg: JsonRpcMessage): string | null {
      if (!lost.size || msg.method !== "tools/call" || msg.params?.name === "iskron_stand")
        return null;
      const r = msg.params?.arguments?.realm;
      const realm = slugOf(typeof r === "string" ? r : "");
      const hit = [...lost.values()].find((e) => slugOf(e.realm) === realm);
      if (hit) return hit.text;
      // Граф, которого мост заведомо держит, свободен; прочий (rN, без графа) — отказ.
      return [...live.values()].some((x) => slugOf(x) === realm)
        ? null
        : [...lost.values()][0].text;
    },
  };
}

// @owner/slug и голый slug — одно написание графа; rN тонкий мост не разрешает.
const slugOf = (realm: string): string => realm.trim().replace(/^@[^/]+\//, "");
