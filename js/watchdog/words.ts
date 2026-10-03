// Слова сторожей (граф nks-dev: #6080): строки, которые сторож пишет делателю, на языке поставки.
// «слушаю стояние» / «listening on standing» — знак, по которому харнес и агент узнают, что слух встал.
import { L } from "../shared/lang.ts";

export const doer = (text: string): string => `${L("ДЕЛАТЕЛЬ", "DOER")}: ${text}`;

export const wd = {
  listening: (key: string | undefined, tail = "") =>
    L(`слушаю стояние ${key}${tail}`, `listening on standing ${key}${tail}`),
  listeningCodex: (key: string | undefined, thread: string | undefined) =>
    L(
      `слушаю стояние ${key}; кадры кладу в тред ${thread}`,
      `listening on standing ${key}; putting frames into thread ${thread}`,
    ),
  backfilled: (count: string) => L(` (${count} задним числом)`, ` (${count} back-dated)`),
  noHeld: () =>
    L(
      "мост не держит ни одного стояния — назовись одним вызовом iskron_stand(realm, karta, model): его ответ назовёт команду слушания",
      "the bridge holds no standing — name yourself with one call to iskron_stand(realm, karta, model): its answer names the listening command",
    ),
  severalHeld: (held: string[]) =>
    L(
      `мост держит несколько стояний — назови нужное: ${held.join(", ")}`,
      `the bridge holds several standings — name the one you need: ${held.join(", ")}`,
    ),
  bridgeLetGo: () =>
    L(
      "мост отпустил стояние или ушёл — сессия кончилась?",
      "the bridge released the standing or went away — did the session end?",
    ),
  seatNotBack: (s: number, path: string) =>
    L(
      `место не вернулось за ${s}s после смены демона — сокет ${path} не поднят; вернуть — iskron_stand`,
      `the seat did not return within ${s}s after the daemon change — socket ${path} is not up; to bring it back use iskron_stand`,
    ),
  noSocket: (path: string, s: number) =>
    L(
      `мост не поднял локальный сокет ${path} за ${s}s`,
      `the bridge did not bring up the local socket ${path} within ${s}s`,
    ),
  bridgeReleasedSocket: (text: string) =>
    L(`мост отпустил сокет: ${text}`, `the bridge released the socket: ${text}`),
  notWakeup: (type: string | undefined) =>
    L(
      `кадр ${type ?? "не разобран"} — не повод будить`,
      `frame ${type ?? "unparsed"} — not a reason to wake`,
    ),
  seenEarlier: (id: string) =>
    L(
      `кадр ${id} уже отдан прежним взводом — не повод будить`,
      `frame ${id} was already delivered by an earlier arming — not a reason to wake`,
    ),
  unaddressed: () =>
    L(
      "пачка без адресованных месту — счёт ждёт ближайшей побудки",
      "a batch with nothing addressed to the seat — the count waits for the next wake-up",
    ),
  staleFrames: () => L("лежалые кадры", "stale frames"),
  seatLost: () => doer(L("стояние потеряно", "the standing is lost")),
  aliveNote: () =>
    doer(
      L(
        "сокет рвут, а служба отвечает — мост держит место",
        "the socket keeps being cut while the service answers — the bridge holds the seat",
      ),
    ),
  codexStale: () => L("Искрон: лежалые кадры", "Iskron: stale frames"),
  codexLost: () =>
    L(
      "Искрон: стояние потеряно — назовись заново: iskron_stand",
      "Iskron: the standing is lost — name yourself again: iskron_stand",
    ),
  codexAlive: () =>
    L(
      "Искрон: сокет рвут, а служба отвечает — мост держит место",
      "Iskron: the socket keeps being cut while the service answers — the bridge holds the seat",
    ),
  noThread: () =>
    doer(
      L(
        "нет CODEX_THREAD_ID — запускай этого сторожа из оболочки сессии Codex: там Codex кладёт id треда в окружение",
        "no CODEX_THREAD_ID — run this watchdog from the Codex session shell: that is where Codex puts the thread id into the environment",
      ),
    ),
  noDoor: (path: string) =>
    doer(
      L(
        `двери нет (${path}) — этот тред не под демоном app-server. Это ход ЧЕЛОВЕКА до запуска сессии, не твой: демон и сессия Codex должны стартовать с одним коротким CODEX_HOME (рецепт в SETUP, раздел Codex). Скажи ему это; пока двери нет — слушай watchdog-exit`,
        `no door (${path}) — this thread is not under an app-server daemon. This is the HUMAN's move before the session starts, not yours: the daemon and the Codex session must start with one short CODEX_HOME (recipe in SETUP, section Codex). Tell them so; until there is a door, listen with watchdog-exit`,
      ),
    ),
  threadRefused: (why: string) =>
    doer(L(`тред не принял кадр — ${why}`, `the thread did not accept the frame — ${why}`)),
  refusal: () => L("отказ", "refusal"),
  framePut: (thread: string | undefined) =>
    L(`кадр вложен в тред ${thread}`, `frame put into thread ${thread}`),
  frameSent: (thread: string | undefined) =>
    L(`кадр отправлен в тред ${thread}`, `frame sent to thread ${thread}`),
  flushNotPut: (s: number) =>
    doer(
      L(
        `не дождался вложения за ${s}s после своего отпускания — пачка в тред не отправлена`,
        `the put did not go through within ${s}s after one's own release — the batch was not sent to the thread`,
      ),
    ),
  frameNotPut: (why: string) =>
    doer(L(`кадр не вложился — ${why}`, `the frame was not put in — ${why}`)),
  doorClosed: (why: string, lost: string[]) =>
    L(
      `дверь закрылась: ${why} — открою заново на следующем кадре` +
        (lost.length
          ? `; без ответа: ${lost.join(", ")} — вернутся из кольца следующим взводом`
          : ""),
      `the door closed: ${why} — will reopen on the next frame` +
        (lost.length
          ? `; unanswered: ${lost.join(", ")} — will come back from the ring on the next arming`
          : ""),
    ),
  doorNotOpened: (why: string) => L(`дверь не открылась: ${why}`, `the door did not open: ${why}`),
  noIdFromRing: () =>
    L(
      "кадр без id из кольца — пометить нечем, в тред не кладу повторно",
      "a frame without an id from the ring — nothing to mark it with, not putting it into the thread again",
    ),
  alreadyPut: (id: string) =>
    L(
      `кадр ${id} уже вложен — в тред не кладу повторно`,
      `frame ${id} was already put in — not putting it into the thread again`,
    ),
};
