// Слова плагина OpenCode о слухе и местах (граф @nks/nks-dev, узел #6806 п.7):
// возврат места и сторож слуха, продление каталога, маркер потери, перенос сессии,
// близнецы каталога, вход человека.
import type { Lang } from "../lang.ts";

export interface OpencodeKeepWords {
  resumed: (key: string) => string;
  /** Место, которое мост доказал своим (на нём стояла эта сессия): чужим не подозревается. */
  resumedOwn: (key: string) => string;
  /** keys — места через запятую. */
  elsewhere: (keys: string) => string;
  notBack: (place: string, why: string) => string;
  noKeyNoDir: () => string;
  noAnswer: () => string;
  legacy: (word: string) => string;
  sessionResumed: (root: string, word: string) => string;
  resumeFailed: (root: string, message: string) => string;
  retryFailed: (place: string, why: string) => string;
  noWhy: () => string;
  watchResumed: (root: string, word: string) => string;
  watchReopened: (root: string, word: string) => string;
  watchFailed: (root: string, message: string) => string;
  /** Заголовок служебной сессии продления: по нему её узнают в событиях. */
  keepaliveTitle: () => string;
  noRemove: (title: string) => string;
  cap: (max: number, title: string) => string;
  notCreated: (message: string) => string;
  noId: (answer: string, title: string) => string;
  notRemoved: (id: string) => string;
  tickFailed: (message: string) => string;
  /** where — места через запятую. */
  lostWord: (hhmm: string, where: string) => string;
  /** name — пусто, когда имени нет. */
  movedWhy: (name: string) => string;
  revokedMoved: (name: string) => string;
  twinUp: (dir: string) => string;
  markerUntaken: (seconds: number) => string;
  unloaded: (dir: string, named: string, why: string) => string;
  thisSession: () => string;
  seatLost: (key: string, dir: string, why: string) => string;
  movedAway: (session: string, dir: string) => string;
  takenFromNew: (session: string) => string;
  parentMoved: () => string;
  farRefusal: () => string;
  elsewhereDevice: (device: string) => string;
  /** why — слово моста, почему кода нет, либо пусто. */
  elsewhereTunnel: (why: string) => string;
  needLoginError: (open: string, elsewhere: string) => string;
  openAndFinish: (url: string) => string;
  finishItInBrowser: () => string;
  needLogin: (open: string, elsewhere: string) => string;
  codeUntil: (link: string, until: string) => string;
}

export const OPENCODE_KEEP: Readonly<Record<Lang, OpencodeKeepWords>> = {
  ru: {
    resumed: (key) =>
      `Искрон: мост поднялся и сам вернул место ${key} — по своей записи держания (каталог сессии либо ключ прежнего места), без твоего хода. ` +
      'Сверь имя с выведенным для этой сессии: чужое — отпусти его iskron_channel(action="leave") (канал цел; revoke места, основавшего канал, платформа отвергает) и займи своё одним iskron_stand; ' +
      "запись, уже ушедшую этим ходом, проверь по автору в истории узла — слово под чужим именем ляжет другому месту, а мост ответит успехом.",
    resumedOwn: (key) =>
      `Искрон: мост поднялся и сам вернул место ${key} — своё, на нём стояла эта сессия; без твоего хода.`,
    elsewhere: (keys) =>
      `Искрон: возврат места ${keys} с диска не удался — его сокет держит другой живой мост, не тот, что служит этой сессии сейчас: ` +
      "слух и занятость здесь места не держат. Позови iskron_stand с этим именем, take не нужен: место прежнего моста этой же сессии " +
      "мост вернёт сам, место другой сессии не тронет и встанет рядом на имя.N со слухом.",
    notBack: (place, why) =>
      `Искрон: место ${place} с диска не вернулось: ${why}. ` +
      "Сторож слуха повторит возврат один раз; не ждёшь — iskron_stand.",
    noKeyNoDir: () => "ни ключа места, ни каталога сессии",
    noAnswer: () => "мост не ответил",
    legacy: (word) => `Искрон: ${word}.`,
    sessionResumed: (root, word) => `Искрон: сессия ${root} — ${word}`,
    resumeFailed: (root, message) => `Искрон: возврат места сессии ${root} не удался — ${message}`,
    retryFailed: (place, why) =>
      `Искрон: место ${place} не вернулось и на повторе сторожа: ${why}. ` +
      "Сам сторож его больше не поднимает — займи место iskron_stand.",
    noWhy: () => "мост не сказал почему",
    watchResumed: (root, word) => `Искрон: сторож слуха вернул место сессии ${root} — ${word}`,
    watchReopened: (root, word) => `Искрон: сторож слуха переоткрыл сокет сессии ${root} — ${word}`,
    watchFailed: (root, message) => `Искрон: сторож слуха сессии ${root} — ${message}`,
    keepaliveTitle: () => "iskron: каталог держит место",
    noRemove: (title) =>
      `Искрон: у контекста сессий OpenCode нет remove — служебные сессии продления «${title}» не удаляются и копятся дочерними у места; продление идёт`,
    cap: (max, title) =>
      `Искрон: неудалённых служебных сессий продления больше ${max} — старшие больше не повторяю, удали дочерние «${title}» руками`,
    notCreated: (message) => `Искрон: каталог не продлён — служебная сессия не создана: ${message}`,
    noId: (answer, title) =>
      `Искрон: каталог продлён, но id служебной сессии из ответа create не разобран (${answer}) — она останется дочерней сессией места «${title}», удали её руками`,
    notRemoved: (id) =>
      `Искрон: каталог продлён, служебная сессия ${id} не удалена — повторю на следующем такте`,
    tickFailed: (message) => `Искрон: такт продления каталога сорвался — ${message}`,
    lostWord: (hhmm, where) =>
      `Искрон: слух был потерян в ${hhmm} — плагин остановили (перезапуск, вытеснение каталога) с держащим мостом: ${where}. ` +
      "Место возвращается с диска само; ожидавшие кадры придут пачкой. Не вернулось — iskron_stand.",
    movedWhy: (name) =>
      `поручение этой дочерней сессии кончено переносом родителя в другую папку: её место${name ? ` ${name}` : ""} снято, мост погашен; запись отсюда ушла бы местом родителя`,
    revokedMoved: (name) =>
      `Искрон: ${name} — субагент, кончённый переносом родителя: прежний экземпляр погасил его мост и снял место, ` +
      "итог лёг родителю словом «перенесён»; revoke не нужен и не послан.",
    twinUp: (dir) => `Искрон: экземпляр каталога ${dir} поднят заново — место вернул он`,
    markerUntaken: (seconds) => `за ${seconds} с маркер его мест никто не взял`,
    unloaded: (dir, named, why) =>
      `Искрон: каталог ${dir} выгружен с местом (${named}) и не поднят — ${why}`,
    thisSession: () => "этой сессии",
    seatLost: (key, dir, why) =>
      `Искрон: место ${key} отпущено — экземпляр плагина каталога ${dir} ` +
      `выгружен и не поднялся (${why}). Верни место: iskron_stand.`,
    movedAway: (session, dir) =>
      `Искрон: сессия ${session} перенесена в ${dir} — её место отпускаю экземпляру той папки`,
    takenFromNew: (session) =>
      `Искрон: место сессии ${session} занято из её новой папки — она перенесена`,
    parentMoved: () =>
      `Отказано (плагин): родитель этой сессии перенесён в другую папку — её поручение кончено переносом, ` +
      "мост родителя здесь не поднимается, а своего места у неё нет; работа этой сессии — дальше без графа, либо слово запустившему.",
    farRefusal: () =>
      "Отказано (плагин): эта дочерняя сессия перенесена в другой каталог, чем её родитель, а место родителя " +
      "не держит ни один экземпляр плагина этого процесса OpenCode — родитель в другом процессе либо места не держит. " +
      "Спутником отсюда не встать; читать можно и так, писать — словом запустившему.",
    elsewhereDevice: (device) =>
      `с другого устройства (телефон подойдёт) — ${device}; либо личный токен в ~/.iskron-bridge/token`,
    elsewhereTunnel: (why) =>
      (why ? `${why}; ` : "") +
      "с другой машины — ssh -L <порт>:127.0.0.1:<порт>, либо личный токен в ~/.iskron-bridge/token",
    needLoginError: (open, elsewhere) =>
      `Искрон: нужен вход в граф — ${open} и повтори вызов. ` +
      `Адрес локальный для машины OpenCode: ${elsewhere} (скилл establish-mcp).`,
    openAndFinish: (url) => `открой ${url} и заверши его`,
    finishItInBrowser: () => "заверши его в браузере",
    needLogin: (open, elsewhere) =>
      `Искрон: нужен вход — ${open}; ` +
      `адрес локальный: ${elsewhere}. ` +
      "Тулы iskron_* поднимутся после входа сами.",
    codeUntil: (link, until) => `${link} (код действует до ${until} UTC)`,
  },
  en: {
    resumed: (key) =>
      `Iskron: the bridge came up and returned the seat ${key} itself — by its own holding record (the session's directory or the previous seat's key), without your move. ` +
      'Check the name against the one derived for this session: if it is someone else\'s, release it with iskron_channel(action="leave") (the channel stays; the platform rejects a revoke of the seat that founded the channel) and take your own with one iskron_stand; ' +
      "a write that already went out on this move — check it by its author in the node's history: a word under someone else's name lands on another seat, and the bridge answers with success.",
    resumedOwn: (key) =>
      `Iskron: the bridge came up and returned the seat ${key} itself — your own, this session stood on it; without your move.`,
    elsewhere: (keys) =>
      `Iskron: returning the seat ${keys} from disk failed — its socket is held by another live bridge, not the one serving this session now: ` +
      "hearing and the busy line here hold no seat. Call iskron_stand with this name, no take needed: the seat of this same session's previous bridge " +
      "the bridge returns itself, it does not touch another session's seat and stands beside on name.N with hearing.",
    notBack: (place, why) =>
      `Iskron: the seat ${place} did not return from disk: ${why}. ` +
      "The hearing watchdog retries the return once; if you will not wait — iskron_stand.",
    noKeyNoDir: () => "neither a seat key nor a session directory",
    noAnswer: () => "the bridge did not answer",
    legacy: (word) => `Iskron: ${word}.`,
    sessionResumed: (root, word) => `Iskron: session ${root} — ${word}`,
    resumeFailed: (root, message) =>
      `Iskron: returning the seat of session ${root} failed — ${message}`,
    retryFailed: (place, why) =>
      `Iskron: the seat ${place} did not return on the watchdog's retry either: ${why}. ` +
      "The watchdog no longer raises it by itself — take the seat with iskron_stand.",
    noWhy: () => "the bridge did not say why",
    watchResumed: (root, word) =>
      `Iskron: the hearing watchdog returned the seat of session ${root} — ${word}`,
    watchReopened: (root, word) =>
      `Iskron: the hearing watchdog reopened the socket of session ${root} — ${word}`,
    watchFailed: (root, message) => `Iskron: the hearing watchdog of session ${root} — ${message}`,
    keepaliveTitle: () => "iskron: the directory holds a seat",
    noRemove: (title) =>
      `Iskron: the OpenCode sessions context has no remove — keepalive service sessions «${title}» are not removed and pile up as children of the seat; the keepalive goes on`,
    cap: (max, title) =>
      `Iskron: more than ${max} keepalive service sessions are not removed — no longer retrying the oldest, remove the children «${title}» by hand`,
    notCreated: (message) =>
      `Iskron: the directory was not kept alive — the service session was not created: ${message}`,
    noId: (answer, title) =>
      `Iskron: the directory was kept alive, but the service session's id was not parsed from the create answer (${answer}) — it stays a child session of the seat «${title}», remove it by hand`,
    notRemoved: (id) =>
      `Iskron: the directory was kept alive, the service session ${id} was not removed — retrying on the next tact`,
    tickFailed: (message) => `Iskron: the directory keepalive tact failed — ${message}`,
    lostWord: (hhmm, where) =>
      `Iskron: hearing was lost at ${hhmm} — the plugin was stopped (restart, directory eviction) with a holding bridge: ${where}. ` +
      "The seat returns from disk by itself; the waiting frames come as a batch. If it did not return — iskron_stand.",
    movedWhy: (name) =>
      `this child session's errand ended with the parent's move to another folder: its seat${name ? ` ${name}` : ""} is revoked, the bridge is down; a write from here would go under the parent's seat`,
    revokedMoved: (name) =>
      `Iskron: ${name} is a subagent ended by the parent's move: the previous instance put its bridge down and revoked its seat, ` +
      "the outcome reached the parent as the word «moved»; no revoke is needed and none was sent.",
    twinUp: (dir) =>
      `Iskron: the instance of directory ${dir} was raised again — it returned the seat`,
    markerUntaken: (seconds) => `nobody took the marker of its seats within ${seconds} s`,
    unloaded: (dir, named, why) =>
      `Iskron: directory ${dir} was unloaded with a seat (${named}) and not raised — ${why}`,
    thisSession: () => "of this session",
    seatLost: (key, dir, why) =>
      `Iskron: the seat ${key} was released — the plugin instance of directory ${dir} ` +
      `was unloaded and did not come up (${why}). Return the seat: iskron_stand.`,
    movedAway: (session, dir) =>
      `Iskron: session ${session} was moved to ${dir} — releasing its seat to that folder's instance`,
    takenFromNew: (session) =>
      `Iskron: the seat of session ${session} was taken from its new folder — it was moved`,
    parentMoved: () =>
      "Refused (plugin): this session's parent was moved to another folder — its errand ended with the move, " +
      "the parent's bridge is not raised here, and it has no seat of its own; this session's work goes on without the graph, or by a word to the launcher.",
    farRefusal: () =>
      "Refused (plugin): this child session was moved to a different directory than its parent, and the parent's seat " +
      "is held by no plugin instance of this OpenCode process — the parent is in another process or holds no seat. " +
      "No standing as a satellite from here; reading works as is, writing — by a word to the launcher.",
    elsewhereDevice: (device) =>
      `from another device (a phone will do) — ${device}; or a personal token in ~/.iskron-bridge/token`,
    elsewhereTunnel: (why) =>
      (why ? `${why}; ` : "") +
      "from another machine — ssh -L <port>:127.0.0.1:<port>, or a personal token in ~/.iskron-bridge/token",
    needLoginError: (open, elsewhere) =>
      `Iskron: sign-in to the graph is needed — ${open} and repeat the call. ` +
      `The address is local to the OpenCode machine: ${elsewhere} (the establish-mcp skill).`,
    openAndFinish: (url) => `open ${url} and finish it`,
    finishItInBrowser: () => "finish it in the browser",
    needLogin: (open, elsewhere) =>
      `Iskron: sign-in needed — ${open}; ` +
      `the address is local: ${elsewhere}. ` +
      "The iskron_* tools come up by themselves after sign-in.",
    codeUntil: (link, until) => `${link} (the code is valid until ${until} UTC)`,
  },
};
