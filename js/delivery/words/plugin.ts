// Слова, общие плагину OpenCode и расширению pi (граф @nks/nks-dev, узел #6806 п.7):
// поиск и подъём моста, половина «канал» — слух, мёртвый токен, отъём места.
import type { Lang } from "../lang.ts";
import { TAKE } from "./take.ts";

export interface PluginWords {
  /** tried — кандидаты через запятую. */
  noBridge: (tried: string) => string;
  /** Строка stderr моста, поднятого плагином. */
  bridgeLine: (line: string) => string;
  notRaised: (message: string) => string;
  refusalNoText: (name: string) => string;
  relistFailed: (message: string) => string;
  listening: () => string;
  dead: (code: number | string) => string;
  /** text — слово стопа моста (снятие места владельцем, #7439): человеку, без хода сессии. */
  stopped: (text: string) => string;
  /** stopped — слово стопа (`stopped`): в контексте хода остановленной сессии, пока она не встала снова. */
  stoppedTurn: (stopped: string) => string;
  evicted: (code: number | string) => string;
  alive: (version: string) => string;
  note: (text: string) => string;
}

export const PLUGIN: Readonly<Record<Lang, PluginWords>> = {
  ru: {
    noBridge: (tried) =>
      "Искрон: мост не найден — тулов iskron_* в этой сессии не будет. Искал: " +
      tried +
      ". Задай ISKRON_BRIDGE_PATH или поставь мост скиллом establish-mcp.",
    bridgeLine: (line) => `Искрон/мост: ${line}`,
    notRaised: (message) => `Искрон: мост не поднялся — ${message}`,
    refusalNoText: (name) => `${name}: отказ без текста`,
    relistFailed: (message) =>
      `Искрон: список тулов после смены на сервере не перечитан — ${message}`,
    listening: () => "Искрон: канал слушает",
    dead: (code) =>
      String(code) === "4002"
        ? "Искрон: канал закрыт кодом 4002 — место погасло по простою. Вернуть его — iskron_stand тем же именем."
        : `Искрон: канал закрыт кодом ${code} — токен мёртв. Зови iskron_channel(action="connect")` +
          ", затем register тем же именем: новый сокет мост возьмёт из ответа сам, перезапуск не нужен.",
    stopped: (text) => `Искрон: ${text}`,
    stoppedTurn: (stopped) =>
      `${stopped}. Это слово стоит, пока место снято; человек велит встать снова — встань явным вызовом iskron_stand, и слово уйдёт.`,
    evicted: (code) =>
      `Искрон: канал закрыт кодом ${code} — место отняли, слушает другой держатель. ` +
      "Мост сам встаёт рядом на имя.N со слухом — своё место, чужое не перехватывается; исход — следующим словом, место и команду сторожа скажет iskron_stand тем же вызовом. " +
      `Вытеснить ту сессию (take=true): ${TAKE.ru.rule()}.`,
    alive: (version) =>
      `Искрон: сокет рвут, а служба отвечает (${version}) — мост держит место и переоткрывает реже; ` +
      "не пройдёт — спроси о токене.",
    note: (text) => `Искрон: ${text}`,
  },
  en: {
    noBridge: (tried) =>
      "Iskron: the bridge was not found — there will be no iskron_* tools in this session. Looked in: " +
      tried +
      ". Set ISKRON_BRIDGE_PATH or install the bridge with the establish-mcp skill.",
    bridgeLine: (line) => `Iskron/bridge: ${line}`,
    notRaised: (message) => `Iskron: the bridge did not come up — ${message}`,
    refusalNoText: (name) => `${name}: refusal without text`,
    relistFailed: (message) =>
      `Iskron: the tool list was not reread after the change on the server — ${message}`,
    listening: () => "Iskron: the channel is listening",
    dead: (code) =>
      String(code) === "4002"
        ? "Iskron: the channel was closed with code 4002 — the seat went out after idling. To return it — iskron_stand with the same name."
        : `Iskron: the channel was closed with code ${code} — the token is dead. Call iskron_channel(action="connect")` +
          ", then register with the same name: the bridge takes the new socket from the answer itself, no restart needed.",
    stopped: (text) => `Iskron: ${text}`,
    stoppedTurn: (stopped) =>
      `${stopped}. This word stands while the seat is taken off; if the human tells you to stand again — stand by an explicit iskron_stand call, and the word goes.`,
    evicted: (code) =>
      `Iskron: the channel was closed with code ${code} — the seat was taken, another holder is listening. ` +
      "The bridge stands beside as name.N with hearing itself — its own seat, the other one is not taken over; the outcome comes next, iskron_stand with the same call tells the seat and the watchdog command. " +
      `Evicting that session (take=true): ${TAKE.en.rule()}.`,
    alive: (version) =>
      `Iskron: the socket keeps being cut while the service answers (${version}) — the bridge holds the seat and reopens less often; ` +
      "if it fails, ask about the token.",
    note: (text) => `Iskron: ${text}`,
  },
};
