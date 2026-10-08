// Слова сторожей (граф @nks/nks-dev, узел #6080): строки, которые сторож пишет делателю.
// «слушаю стояние» / «listening on standing» — знак, по которому харнес и агент узнают, что слух встал.
import type { Lang } from "../lang.ts";

export interface WatchdogWords {
  doer: (text: string) => string;
  listening: (key: string | undefined, tail?: string) => string;
  listeningCodex: (key: string | undefined, thread: string | undefined) => string;
  /** count — готовое число кадров (frames). */
  backfilled: (count: string) => string;
  frames: (n: number) => string;
  noHeld: () => string;
  /** held — ключи через запятую. */
  severalHeld: (held: string) => string;
  bridgeLetGo: () => string;
  seatNotBack: (s: number, path: string) => string;
  noSocket: (path: string, s: number) => string;
  bridgeReleasedSocket: (text: string) => string;
  notWakeup: (type: string | undefined) => string;
  seenEarlier: (id: string) => string;
  unaddressed: () => string;
  seatLost: () => string;
  aliveNote: () => string;
  codexLost: () => string;
  codexAlive: () => string;
  noThread: () => string;
  noDoor: (path: string) => string;
  threadRefused: (why: string) => string;
  refusal: () => string;
  framePut: (thread: string | undefined) => string;
  frameSent: (thread: string | undefined) => string;
  flushNotPut: (s: number) => string;
  frameNotPut: (why: string) => string;
  /** lost — id без ответа через запятую; пусто — их нет. */
  doorClosed: (why: string, lost: string) => string;
  doorNotOpened: (why: string) => string;
  noIdFromRing: () => string;
  alreadyPut: (id: string) => string;
}

const ruFrames = (n: number): string => {
  const m10 = n % 10;
  const m100 = n % 100;
  const form =
    m10 === 1 && m100 !== 11 ? 0 : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 1 : 2;
  return `${n} ${["кадр", "кадра", "кадров"][form]}`;
};

export const WATCHDOG: Readonly<Record<Lang, WatchdogWords>> = {
  ru: {
    doer: (text) => `ДЕЛАТЕЛЬ: ${text}`,
    listening: (key, tail = "") => `слушаю стояние ${key}${tail}`,
    listeningCodex: (key, thread) => `слушаю стояние ${key}; кадры кладу в тред ${thread}`,
    backfilled: (count) => ` (${count} задним числом)`,
    frames: ruFrames,
    noHeld: () =>
      "мост не держит ни одного стояния — назовись одним вызовом iskron_stand(realm, karta, model): его ответ назовёт команду слушания",
    severalHeld: (held) => `мост держит несколько стояний — назови нужное: ${held}`,
    bridgeLetGo: () => "мост отпустил стояние или ушёл — сессия кончилась?",
    seatNotBack: (s, path) =>
      `место не вернулось за ${s}s после смены демона — сокет ${path} не поднят; вернуть — iskron_stand`,
    noSocket: (path, s) => `мост не поднял локальный сокет ${path} за ${s}s`,
    bridgeReleasedSocket: (text) => `мост отпустил сокет: ${text}`,
    notWakeup: (type) => `кадр ${type ?? "не разобран"} — не повод будить`,
    seenEarlier: (id) => `кадр ${id} уже отдан прежним взводом — не повод будить`,
    unaddressed: () => "пачка без адресованных месту — счёт ждёт ближайшей побудки",
    seatLost: () => "ДЕЛАТЕЛЬ: стояние потеряно",
    aliveNote: () => "ДЕЛАТЕЛЬ: сокет рвут, а служба отвечает — мост держит место",
    codexLost: () => "Искрон: стояние потеряно — назовись заново: iskron_stand",
    codexAlive: () => "Искрон: сокет рвут, а служба отвечает — мост держит место",
    noThread: () =>
      "ДЕЛАТЕЛЬ: нет CODEX_THREAD_ID — запускай этого сторожа из оболочки сессии Codex: там Codex кладёт id треда в окружение",
    noDoor: (path) =>
      `ДЕЛАТЕЛЬ: двери нет (${path}) — этот тред не под демоном app-server. Это ход ЧЕЛОВЕКА до запуска сессии, не твой: демон и сессия Codex должны стартовать с одним коротким CODEX_HOME (рецепт в SETUP, раздел Codex). Скажи ему это; пока двери нет — слушай watchdog-exit`,
    threadRefused: (why) => `ДЕЛАТЕЛЬ: тред не принял кадр — ${why}`,
    refusal: () => "отказ",
    framePut: (thread) => `кадр вложен в тред ${thread}`,
    frameSent: (thread) => `кадр отправлен в тред ${thread}`,
    flushNotPut: (s) =>
      `ДЕЛАТЕЛЬ: не дождался вложения за ${s}s после своего отпускания — пачка в тред не отправлена`,
    frameNotPut: (why) => `ДЕЛАТЕЛЬ: кадр не вложился — ${why}`,
    doorClosed: (why, lost) =>
      `дверь закрылась: ${why} — открою заново на следующем кадре` +
      (lost ? `; без ответа: ${lost} — вернутся из кольца следующим взводом` : ""),
    doorNotOpened: (why) => `дверь не открылась: ${why}`,
    noIdFromRing: () => "кадр без id из кольца — пометить нечем, в тред не кладу повторно",
    alreadyPut: (id) => `кадр ${id} уже вложен — в тред не кладу повторно`,
  },
  en: {
    doer: (text) => `DOER: ${text}`,
    listening: (key, tail = "") => `listening on standing ${key}${tail}`,
    listeningCodex: (key, thread) =>
      `listening on standing ${key}; putting frames into thread ${thread}`,
    backfilled: (count) => ` (${count} back-dated)`,
    frames: (n) => `${n} ${n === 1 ? "frame" : "frames"}`,
    noHeld: () =>
      "the bridge holds no standing — name yourself with one call to iskron_stand(realm, karta, model): its answer names the listening command",
    severalHeld: (held) => `the bridge holds several standings — name the one you need: ${held}`,
    bridgeLetGo: () => "the bridge released the standing or went away — did the session end?",
    seatNotBack: (s, path) =>
      `the seat did not return within ${s}s after the daemon change — socket ${path} is not up; to bring it back use iskron_stand`,
    noSocket: (path, s) => `the bridge did not bring up the local socket ${path} within ${s}s`,
    bridgeReleasedSocket: (text) => `the bridge released the socket: ${text}`,
    notWakeup: (type) => `frame ${type ?? "unparsed"} — not a reason to wake`,
    seenEarlier: (id) =>
      `frame ${id} was already delivered by an earlier arming — not a reason to wake`,
    unaddressed: () =>
      "a batch with nothing addressed to the seat — the count waits for the next wake-up",
    seatLost: () => "DOER: the standing is lost",
    aliveNote: () =>
      "DOER: the socket keeps being cut while the service answers — the bridge holds the seat",
    codexLost: () => "Iskron: the standing is lost — name yourself again: iskron_stand",
    codexAlive: () =>
      "Iskron: the socket keeps being cut while the service answers — the bridge holds the seat",
    noThread: () =>
      "DOER: no CODEX_THREAD_ID — run this watchdog from the Codex session shell: that is where Codex puts the thread id into the environment",
    noDoor: (path) =>
      `DOER: no door (${path}) — this thread is not under an app-server daemon. This is the HUMAN's move before the session starts, not yours: the daemon and the Codex session must start with one short CODEX_HOME (recipe in SETUP, section Codex). Tell them so; until there is a door, listen with watchdog-exit`,
    threadRefused: (why) => `DOER: the thread did not accept the frame — ${why}`,
    refusal: () => "refusal",
    framePut: (thread) => `frame put into thread ${thread}`,
    frameSent: (thread) => `frame sent to thread ${thread}`,
    flushNotPut: (s) =>
      `DOER: the put did not go through within ${s}s after one's own release — the batch was not sent to the thread`,
    frameNotPut: (why) => `DOER: the frame was not put in — ${why}`,
    doorClosed: (why, lost) =>
      `the door closed: ${why} — will reopen on the next frame` +
      (lost ? `; unanswered: ${lost} — will come back from the ring on the next arming` : ""),
    doorNotOpened: (why) => `the door did not open: ${why}`,
    noIdFromRing: () =>
      "a frame without an id from the ring — nothing to mark it with, not putting it into the thread again",
    alreadyPut: (id) => `frame ${id} was already put in — not putting it into the thread again`,
  },
};
