// Места сессии глазами тонкого моста (thin.ts) и их потеря при смене демона.
// Места — ключ → граф, как его назвал агент: основное — по уведомлению held,
// рядом в других графах — по beside (снятое — beside-gone). Место не вернулось в
// новой сессии — агенту уведомлением lost сейчас и отказом каждого вызова тула в
// его граф, кроме iskron_stand, пока место с тем же ключом не взято снова; у
// спутника — любое место-спутник того же графа (имя .sub-N выбирает мост).
// Граф вызова сличается с графом потери по realms.ts — канонической формой
// @owner/slug с разрешением rN и слага; вызов без графа свободен, чужой владелец
// того же слага — другой граф, а имя, не разрешённое против потерянных, — отказ
// с просьбой полного адреса (#5838), не текст чужой потери.
import { L } from "../shared/lang.ts";
import { learnRealmList, realmRelation, sameRealm, unresolvedWord } from "./realms.ts";
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

/**
 * Сессия харнеса, которую плагин называет мосту (iskron/resume, iskron/check): тонкий
 * мост помнит её и несёт в возврат места в новой сессии демона — без неё запись
 * держания легла бы без сессии, и своё место сессия сочла бы чужим (#6702).
 */
let harnessSession: string | null = null;
/** Запомнить сессию харнеса из его вызова; вызов — как есть. */
export function seeSession(msg: JsonRpcMessage): JsonRpcMessage {
  const s = msg.params?.session;
  if ((msg.method === "iskron/resume" || msg.method === "iskron/check") && typeof s === "string")
    harnessSession = s.trim() || harnessSession;
  return msg;
}
/** Параметры возврата места в новой сессии демона: ключ и названная сессия харнеса. */
export const resumeParams = (key: string): { key: string; session?: string } =>
  harnessSession ? { key, session: harnessSession } : { key };

export function lostPlaces(say: (m: JsonRpcMessage) => void, log: (m: string) => void) {
  const live = new Map<string, string>();
  const lost = new Map<string, { realm: string; satellite: boolean; text: string }>();
  return {
    live,
    /** Место снова взято (held, beside) — отказ по нему снят. */
    regained(k: string, realm: string): void {
      live.set(k, realm);
      for (const [lk, e] of lost)
        if (lk === k || (e.satellite && sameRealm(e.realm, realm))) lost.delete(lk);
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
    /** Сколько мест потеряно — тонкий мост решает по этому, учить ли имена графов. */
    lostCount(): number {
      return lost.size;
    },
    /**
     * Слово о месте, пришедшее тонкому мосту, свёрнуто здесь; возвращает heldKey
     * после слова. «Держу» и «рядом» — место взято: отказ по нему снят; held с
     * иным ключом — агент сменил основное место, и прежний ключ из live прочь —
     * иначе следующий обрыв назвал бы его потерей. «Отпущено» (released) словом
     * сессии демона при живом харнесе (`daemonSession`) — не уход агента: так
     * кончается демон без преемника (SIGTERM/SIGINT), и ключ остаётся —
     * переподхват вернёт место по записи держания (iskron/resume), а не выйдет —
     * скажет lost вслух. Подлинный уход агента идёт через собственный leave
     * тонкого моста, смерть и отъём места — словами dead и evicted.
     */
    seen(
      place: { kind: string; key?: string; realm: string } | null,
      heldKey: string | null,
      daemonSession: boolean,
    ): string | null {
      if ((place?.kind === "held" || place?.kind === "beside") && place.key) {
        if (place.kind === "held") {
          if (heldKey && heldKey !== place.key) live.delete(heldKey);
          heldKey = place.key;
        }
        this.regained(place.key, place.realm); // место снова взято — отказ по нему снят
      } else if (place?.kind === "beside-gone" && place.key) live.delete(place.key);
      else if (
        place &&
        ["released", "dead", "evicted"].includes(place.kind) &&
        (!place.key || place.key === heldKey) &&
        !(place.kind === "released" && daemonSession)
      ) {
        if (heldKey) live.delete(heldKey);
        heldKey = null;
      }
      return heldKey;
    },
    /**
     * Отказ вызова тула из-за потерянного места; null — пропустить. Отказ
     * касается только вызовов в потерянный граф: вызов без графа свободен, граф
     * сличается канонически (realms.ts), и отказ подписан графом вызова, а не
     * первой попавшейся потери. Имя, не разрешённое против потерянных, — отказ с
     * просьбой полного адреса (#5838): гадать нельзя, а пропустить — записать без автора.
     */
    refusal(msg: JsonRpcMessage): string | null {
      if (!lost.size || msg.method !== "tools/call" || msg.params?.name === "iskron_stand")
        return null;
      const r = msg.params?.arguments?.realm;
      if (typeof r !== "string" || !r.trim()) return null; // вызов без графа — не в потерянный граф
      const hit = [...lost.entries()].find(([, e]) => realmRelation(r, e.realm) === "same");
      if (hit) return hit[1].text;
      // Граф, который мост держит, свободен; уверенно другой граф — тоже.
      if ([...live.values()].some((x) => realmRelation(r, x) === "same")) return null;
      return [...lost.values()].some((e) => realmRelation(r, e.realm) === "unknown")
        ? unresolvedWord(r, [...live.values()])
        : null;
    },
  };
}

/**
 * Служебные вызовы списка графов (iskron_realm list) тонкого моста: отказ
 * потерянного места сличает rN и слаг вызова с графом потери (realms.ts), а без
 * списка всякое неразрешённое имя — отказ с просьбой полного адреса. Мост зовёт
 * список сам, своим id (`iskron-thin-realms-*`), когда потери есть: при
 * переподхвате — сразу, по отказу возврата места — когда потеря открылась
 * ответом iskron/resume. Отказ вместо списка — громко в log, не молчание.
 */
export function realmListAsk() {
  const asked = new Set<string>(); // JSON.stringify(id) своих вызовов без ответа
  return {
    /** Вызов списка, когда потери есть; null — потерь нет или спрос уже в полёте. */
    ask(lostCount: number, id: () => string): JsonRpcMessage | null {
      if (!lostCount || asked.size) return null;
      const call: JsonRpcMessage = {
        jsonrpc: "2.0",
        id: id(),
        method: "tools/call",
        params: { name: "iskron_realm", arguments: { action: "list" } },
      };
      asked.add(JSON.stringify(call.id));
      return call;
    },
    /** Ответ собственного вызова списка: true — потреблён (алиасы учтены, отказ — громко). */
    reply(msg: JsonRpcMessage, log: (m: string) => void): boolean {
      if (msg.method !== undefined || msg.id === undefined || msg.id === null) return false;
      if (!asked.delete(JSON.stringify(msg.id))) return false;
      const content = msg.result?.content;
      const text = (Array.isArray(content) ? content : [])
        .map((c) => String(c?.text ?? ""))
        .join("\n");
      if (msg.error || msg.result?.isError)
        log(
          `the realm list came back refused instead of the list — rN and slugs stay unresolved: ` +
            `${text || msg.error?.message || "?"}`,
        );
      learnRealmList(text);
      return true;
    },
    /** Ответа не будет (связь порвалась) — позволить спросить снова. */
    forget(): void {
      asked.clear();
    },
  };
}
