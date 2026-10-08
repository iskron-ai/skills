// Запись держания при уходе сессии с неснятого места (граф nks-dev: #5067, #6649).
import { harnessName } from "./client.ts";
import { readHoldRecord, sessionOfBridge, writeHoldRecord } from "./holdrecord.ts";
import { H } from "./holdstate.ts";
import { extraPlaces, rememberExtraStatus } from "./places.ts";
import { state } from "./transport.ts";

/**
 * Сессия уходит, место не снято (перезапуск плагина, смена демона, конец харнеса):
 * запись держания получает свежий at. Срок записи — простой места без сокета, и
 * считается он от ухода сокета, а не от последней записи: место, державшееся дольше
 * срока без новой занятости, иначе уходило с просроченной записью. Только запись,
 * что есть: стёртую (вытеснение, снятие) уход не воскрешает. Сокет не жив (ушёл с места,
 * обрыв) — at временем его последней жизни, не прежним и не сейчас (#147 [140]).
 */
export function keepHoldRecord(): void {
  const s = state.standing;
  const key = H.currentKey;
  if (!s || !key || !H.currentUrl) return;
  const alive = !!H.holder?.alive;
  const at = alive ? Date.now() : Math.max(H.holder?.heardAt ?? 0, H.heardAt);
  const ch = { url: H.currentUrl, statusUrl: H.currentStatusUrl, cwd: H.standCwd };
  const was = readHoldRecord(key, true);
  if (was && at > (was.at ?? 0))
    writeHoldRecord(
      key,
      {
        ...was,
        realm: s.realm,
        karta: s.karta,
        name: s.name ?? "",
        url: ch.url,
        statusUrl: ch.statusUrl,
        cwd: ch.cwd ?? was.cwd,
        client: harnessName(),
        key,
      },
      false,
      at,
    );
  if (!alive) return; // места рядом молодит только живой сокет
  for (const p of extraPlaces()) {
    const r = readHoldRecord(p.door.key, true);
    if (r) rememberExtraStatus(p.door.key, { ...ch, cwd: ch.cwd ?? r.cwd }, r.status ?? "");
  }
}

/**
 * Сессия названа мосту, который уже держит место (возврат с диска раньше слова
 * плагина): запись держимого места несёт её теперь же — запись без сессии при
 * живом держателе читается местом без сессии, своим для названной сессии харнесса (#6702).
 */
export function signHeldRecord(): void {
  const key = H.currentKey;
  if (!key || !H.holder?.alive || !sessionOfBridge()) return;
  const rec = readHoldRecord(key);
  if (rec && !rec.session && rec.url === H.currentUrl) writeHoldRecord(key, rec);
}
