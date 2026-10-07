// Место отняли закрытием 4000 (граф nks-dev: решение владельца #6706, #5402):
// сессия, чьё место отнято, глухой молча не остаётся. Отнял новый мост этой же
// сессии харнесса (перезапуск, компакшн: его запись держания несёт её) — этот
// экземпляр уступает тихо, место своё. Отняла другая сессия — держатель встаёт
// рядом на имя.N со слухом тем же ходом, что iskron_stand, и говорит это в сессию.
import { CFG } from "./config.ts";
import { type ChannelEvent } from "./door.ts";
import { broadcast, ledKey, notify, releaseStanding, wasEvicted } from "./hold.ts";
import { readHoldRecord, sessionOfBridge } from "./holdrecord.ts";
import { H, whenEvicted } from "./holdstate.ts";
import { holdWords } from "./holdwords.ts";
import { standingLog } from "./store.ts";
import { log } from "./streams.ts";
import { type Standing, state } from "./transport.ts";

/** Сколько ждать записи нового держателя: она ложится сразу за его connect, 4000 может её обогнать. */
const WAIT_MS = 1500;

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

/** Отнял ли место новый мост этой сессии — по записи держания под тем же ключом с другим адресом. */
async function takenBySession(key: string, url: string): Promise<boolean> {
  const me = sessionOfBridge();
  if (!me) return false;
  for (const end = Date.now() + WAIT_MS; ;) {
    const r = readHoldRecord(key, true);
    if (r && r.url !== url) return r.session === me;
    if (Date.now() >= end) return false;
    await new Promise((res) => setTimeout(res, 100));
  }
}

async function yieldPlace(key: string, url: string, code: number): Promise<void> {
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
  announceEvicted(code, holdWords.evictedBeside(code, name));
  const r = wasEvicted(s.realm, s.karta, name) ? await beside(s, H.standCwd) : null;
  if (!r) return;
  const text = r.ok ? holdWords.besideDone(name, r.text) : holdWords.besideFailed(name, r.text);
  log(text);
  standingLog(`evicted ${key}: ${r.ok ? "stood beside" : "could not stand beside"}`);
  // В сессию — словом, как возврат места без её хода (#5366): плагин вкладывает его промптом.
  notify("warning", { kind: "resumed", text });
}

/** Чем встать рядом — iskron_stand (stand.ts), переданный сюда, чтобы не замкнуть импорты. */
const B: { beside: StandBeside | null } = { beside: null };
whenEvicted((key, url, code) => void yieldPlace(key, url, code));
export function wireEviction(beside: StandBeside): void {
  B.beside = beside;
}
