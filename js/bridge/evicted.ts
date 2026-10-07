// Место отняли закрытием 4000 (граф nks-dev: решение владельца #6706, #5402):
// сессия, чьё место отнято, глухой молча не остаётся. Отнял новый мост этой же
// сессии харнесса (перезапуск, компакшн: его запись держания несёт её) — этот
// экземпляр уступает тихо, место своё. Отняла другая сессия — держатель встаёт
// рядом на имя.N со слухом тем же ходом, что iskron_stand, и говорит это в сессию.
import { scoped } from "../shared/scope.ts";
import { CFG } from "./config.ts";
import { signedRealm } from "./deaf.ts";
import { type ChannelEvent } from "./door.ts";
import { UpstreamError } from "./errors.ts";
import { broadcast, ledKey, notify, releaseStanding, wasEvicted } from "./hold.ts";
import { readHoldRecord, sessionOfBridge } from "./holdrecord.ts";
import { H, whenEvicted } from "./holdstate.ts";
import { holdWords } from "./holdwords.ts";
import { otherRealm } from "./realms.ts";
import { baseOf } from "./separate.ts";
import { standingLog } from "./store.ts";
import { log } from "./streams.ts";
import { ownTaking, takerOf } from "./taking.ts";
import { reinitialize, type Standing, state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

/** Как часто перечитывать намерение и запись нового держателя, пока его connect в полёте. */
const LOOK_MS = 100;
/** Через сколько повторить место рядом, когда первую попытку оборвала сеть. */
const RETRY_MS = 2000;

export type StandBeside = (
  place: Standing,
  cwd: string | null,
) => Promise<{ ok: boolean; text: string } | null>;

/** Слово об отъёме (4000) — сторожам, клиенту уведомлений и прицепившимся позже. */
function announceEvicted(code: number, text: string): void {
  log(text);
  const ev: ChannelEvent = { kind: "evicted", code, text };
  H.evictedEvent = ev;
  broadcast(ev);
  notify("warning", ev);
}

/**
 * Отнял ли место новый мост этой сессии — по записи держания под тем же ключом с
 * другим адресом. Её connect ещё в полёте (его намерение лежит, taking.ts; 4000
 * обгоняет ответ) — ждём его исхода, а не срока: намерение пишется до connect,
 * так что без него отнявший — не мост этой сессии на этой машине.
 */
async function takenBySession(key: string, url: string): Promise<boolean> {
  const me = sessionOfBridge();
  if (!me) return false;
  const changed = (): boolean | null => {
    const r = readHoldRecord(key, true);
    return r && r.url !== url ? r.session === me : null;
  };
  for (;;) {
    const got = changed();
    if (got !== null) return got;
    if (takerOf(key) !== me) return changed() ?? false; // запись могла лечь за миг до стирания намерения
    await new Promise((res) => setTimeout(res, LOOK_MS));
  }
}

/**
 * Встать рядом; отказ транспорта (сеть) не теряется необработанным: один
 * отложенный повтор, затем исход — неудачей со словом. Место перестало быть
 * отнятым за ожидание (сессия встала сама) — null, говорить нечего.
 */
async function standBeside(
  key: string,
  s: Standing,
  name: string,
  beside: StandBeside,
  once = false,
): Promise<{ ok: boolean; text: string } | null> {
  // Попытка, сорванная после connect места рядом, уже увела мост с отнятого — повтор доводит её, не молчит.
  let moved = false;
  let reopened = false;
  let retry = once;
  for (;;) {
    if (!moved && !wasEvicted(s.realm, s.karta, name)) return null;
    try {
      return await beside(s, H.standCwd);
    } catch (e) {
      moved ||= ledKey() !== key;
      // Сессия к серверу умерла под попыткой — переоткрыть и повторить, не считая сбоем сети.
      if (e instanceof UpstreamError && e.kind === "session" && !reopened) {
        reopened = true;
        const back = await reinitialize().then(
          () => true,
          () => false,
        );
        if (back) continue;
      }
      const why = e instanceof Error ? e.message : String(e);
      standingLog(`evicted ${key}: standing beside failed (${why})${retry ? "" : " — one retry"}`);
      if (retry) return { ok: false, text: why };
      retry = true;
      await new Promise((res) => setTimeout(res, RETRY_MS));
    }
  }
}

async function yieldPlace(key: string, url: string, code: number): Promise<void> {
  // Свой connect этого места в полёте: 4000 обогнал его ответ — адрес повернул этот мост сам.
  const own = ownTaking(key);
  if (own) {
    await own;
    if (H.currentUrl !== url) return;
  }
  const s = state.standing;
  const beside = B.beside;
  if (await takenBySession(key, url)) {
    if (ledKey() !== key) return; // за ожидание мост уже занял другое
    standingLog(`evicted ${key} by this session's new bridge — released quietly`);
    releaseStanding(holdWords.takenBySession(), false, false, true);
    return;
  }
  // Спутник живёт прогоном и местом рядом не встаёт; безымянному месту нет основы имени.N.
  const name = s?.name ?? "";
  if (CFG.satellite || !s || !name || !beside)
    return announceEvicted(code, holdWords.evicted(code));
  const base = baseOf(s.realm, s.karta, name); // место рядом отняли — следующее рядом с его основой, не proba.2.2
  announceEvicted(code, holdWords.evictedBeside(code, name, base));
  F.failed = null;
  await besideAndSay(key, s, name, base, beside, [...state.places]);
}

/**
 * Встать рядом и сказать исход в сессию. Места других графов на отнятом канале
 * connect места рядом роняет — они встают снова на новом канале тем же ходом и
 * называются в слове. Не вышло — место помнится: следующий вызов харнеса
 * повторит попытку прежде, чем подписаться отнятым (standing.ts).
 */
async function besideAndSay(
  key: string,
  s: Standing,
  name: string,
  base: string,
  beside: StandBeside,
  extras: Standing[],
  once = false,
): Promise<void> {
  const r = await standBeside(key, s, name, beside, once);
  if (!r) return;
  const others: string[] = [];
  if (r.ok)
    for (const x of extras) {
      const again = await beside(x, H.standCwd).catch((e: unknown) => ({
        ok: false,
        text: e instanceof Error ? e.message : String(e),
      }));
      others.push(
        holdWords.besideOther(`${x.name ?? ""} (${x.realm})`, !!again?.ok, again?.text ?? ""),
      );
    }
  F.failed = r.ok ? null : { key, s, name, base, extras };
  const text = [
    r.ok ? holdWords.besideDone(name, r.text) : holdWords.besideFailed(name, base, r.text),
    ...others,
  ].join("\n");
  log(text);
  standingLog(`evicted ${key}: ${r.ok ? "stood beside" : "could not stand beside"}`);
  // В сессию — словом, как возврат места без её хода (#5366): плагин вкладывает его промптом.
  notify("warning", { kind: "resumed", text });
}

/** Встать рядом не вышло (сеть) — что повторить; попытка в полёте одна. */
const F = scoped(() => ({
  failed: null as {
    key: string;
    s: Standing;
    name: string;
    base: string;
    extras: Standing[];
  } | null,
  again: null as Promise<void> | null,
  /** ход после отъёма в полёте — вызов харнеса ждёт его, а не подписывается отнятым */
  pending: null as Promise<void> | null,
}));

/**
 * Место отнято, а встать рядом мост не смог: перед вызовом харнеса — ещё одна
 * попытка, без отложенного повтора. true — отнятое место всё ещё ведомо:
 * подписываться им нельзя (#6706).
 */
export async function standBesideAgain(): Promise<boolean> {
  if (F.pending) await F.pending;
  const s = state.standing;
  if (!s || !wasEvicted(s.realm, s.karta, s.name ?? "")) {
    F.failed = null;
    return false;
  }
  const f = F.failed;
  const beside = B.beside;
  if (f && beside && !F.again)
    F.again = besideAndSay(f.key, f.s, f.name, f.base, beside, f.extras, true).finally(() => {
      F.again = null;
    });
  if (F.again) await F.again;
  return (
    !!state.standing &&
    wasEvicted(state.standing.realm, state.standing.karta, state.standing.name ?? "")
  );
}

/**
 * Вызов харнеса в граф любого места отнятого канала, пока мост не встал рядом:
 * сессия всё ещё привязана к ним, и запись легла бы под подписью места без
 * слуха (#6706). Отказ вслух; iskron_stand и неподписывающие ходы канала идут.
 */
export function evictedRefusal(msg: JsonRpcMessage): string | null {
  const s = state.standing;
  if (!s || !wasEvicted(s.realm, s.karta, s.name ?? "")) return null;
  // Отъём закрывает весь канал: места других графов на нём глухи так же, как основное.
  const realm = signedRealm(msg);
  if (realm == null || [s, ...state.places].every((p) => otherRealm(realm, p.realm))) return null;
  return holdWords.evictedRefusal(s.name ?? "", baseOf(s.realm, s.karta, s.name ?? ""));
}

/** Чем встать рядом — iskron_stand (stand.ts), переданный сюда, чтобы не замкнуть импорты. */
const B: { beside: StandBeside | null } = { beside: null };
whenEvicted((key, url, code) => {
  F.pending = yieldPlace(key, url, code).finally(() => {
    F.pending = null;
  });
});
export function wireEviction(beside: StandBeside): void {
  B.beside = beside;
}
