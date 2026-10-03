// Запись держания при уходе сессии с неснятого места (граф nks-dev: #5067, #6649).
import { harnessName } from "./client.ts";
import { readHoldRecord, writeHoldRecord } from "./holdrecord.ts";
import { H } from "./holdstate.ts";
import { extraPlaces, rememberExtraStatus } from "./places.ts";
import { state } from "./transport.ts";

/**
 * Сессия уходит, место не снято (перезапуск плагина, смена демона, конец харнеса):
 * запись держания получает свежий at. Срок записи — простой места без сокета, и
 * считается он от ухода сокета, а не от последней записи: место, державшееся дольше
 * срока без новой занятости, иначе уходило с просроченной записью. Только запись,
 * что есть: стёртую (вытеснение, снятие) уход не воскрешает. Сокет не жив — молодить нечего.
 */
export function keepHoldRecord(): void {
  const s = state.standing;
  const key = H.currentKey;
  if (!s || !key || !H.currentUrl || !H.holder?.alive) return;
  const ch = { url: H.currentUrl, statusUrl: H.currentStatusUrl, cwd: H.standCwd };
  const was = readHoldRecord(key, true);
  if (was)
    writeHoldRecord(key, {
      ...was,
      realm: s.realm,
      karta: s.karta,
      name: s.name ?? "",
      url: ch.url,
      statusUrl: ch.statusUrl,
      cwd: ch.cwd ?? was.cwd,
      client: harnessName(),
      key,
    });
  for (const p of extraPlaces()) {
    const r = readHoldRecord(p.door.key, true);
    if (r) rememberExtraStatus(p.door.key, { ...ch, cwd: ch.cwd ?? r.cwd }, r.status ?? "");
  }
}
