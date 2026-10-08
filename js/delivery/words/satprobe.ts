// Слова пробы моста-спутника doctor (граф @nks/nks-dev, узел #6080); образцы прозы,
// которую проба разбирает, — в protocol.ts (SAT_LOGIN_RE, SAT_OLD_FLAG_RE).
import type { Lang } from "../lang.ts";

export interface SatProbeWords {
  /** Как войти, когда у машины нет живого входа. */
  loginAdvice: () => string;
  exited: (code: string) => string;
  refusalLogin: (label: string, what: string, advice: string) => string;
  refusal: (label: string, what: string, msg: string) => string;
  silent: (secs: number) => string;
  oldFlag: (flag: string) => string;
  runByHand: () => string;
  noInit: (label: string, why: string, stderrNote: string, old: string) => string;
  /** exited — исход моста; null — молчит. */
  noList: (label: string, name: string, version: string, exited: string | null) => string;
  answered: (label: string, name: string, version: string, tools: number) => string;
  schema: (tool: string | undefined, bad: string) => string;
  winKilled: (label: string, secs: number) => string;
  sigKilled: (label: string, secs: number) => string;
}

export const SAT_PROBE: Readonly<Record<Lang, SatProbeWords>> = {
  ru: {
    loginAdvice: () =>
      "войди: вызови любой тул iskron_* в основной сессии и открой ссылку входа из его ответа (или положи личный токен в ~/.iskron-bridge/token — скилл establish-mcp), потом повтори doctor",
    exited: (code) => `вышел с кодом ${code}`,
    refusalLogin: (label, what, advice) =>
      `проба «${label}»: ${what} — спутник не вошёл: грант машины мёртв или отозван → ${advice}`,
    refusal: (label, what, msg) =>
      `проба «${label}»: ${what} вернул отказ: ${msg} → сделай, что велит отказ, и повтори doctor`,
    silent: (secs) => `молчит ${secs}s`,
    oldFlag: (flag) =>
      ` — похоже, домашний мост старше флага ${flag} → node ~/.iskron-bridge/iskron-bridge.mjs update`,
    runByHand: () => " → запусти эту команду руками и прочти, что она пишет в stderr",
    noInit: (label, why, stderrNote, old) =>
      `проба «${label}»: мост не ответил на initialize (${why}${stderrNote})${old}`,
    noList: (label, name, version, exited) =>
      `проба «${label}»: initialize ответил (${name} v${version}), tools/list — нет (${exited ?? "молчит"}) → запусти команду руками и прочти её stderr`,
    answered: (label, name, version, tools) =>
      `проба «${label}»: мост ответил — ${name} v${version}, тулов ${tools}`,
    schema: (tool, bad) =>
      `тул ${tool}: схема несёт ${bad} на верхнем уровне — сервер отдаёт схему, которую API Anthropic отвергнет («input_schema does not support oneOf, allOf, or anyOf at the top level»), и падает весь прогон субагента, не один этот тул → чинит это сервер, не файл агента и не мост (мост отдаёт схему как есть): скажи имя тула оператору сервера MCP — тому, кто держит адрес из строки «сервер» выше, — и жди его обновления, затем повтори doctor`,
    winKilled: (label, secs) =>
      `проба «${label}»: мост не ушёл по закрытому stdin за ${secs}s — снят принудительно → повтори doctor; если он менял токен, вход может понадобиться заново`,
    sigKilled: (label, secs) =>
      `проба «${label}»: мост не ушёл ни по закрытому stdin, ни по SIGTERM за ${secs}s — снят SIGKILL → повтори doctor; если он менял токен, вход может понадобиться заново`,
  },
  en: {
    loginAdvice: () =>
      "log in: call any iskron_* tool in the main session and open the login link from its answer (or put a personal token in ~/.iskron-bridge/token — the establish-mcp skill), then repeat doctor",
    exited: (code) => `exited with code ${code}`,
    refusalLogin: (label, what, advice) =>
      `probe "${label}": ${what} — the satellite is not logged in: the machine grant is dead or revoked → ${advice}`,
    refusal: (label, what, msg) =>
      `probe "${label}": ${what} returned a refusal: ${msg} → do what the refusal says and repeat doctor`,
    silent: (secs) => `silent for ${secs}s`,
    oldFlag: (flag) =>
      ` — it seems the home bridge is older than the ${flag} flag → node ~/.iskron-bridge/iskron-bridge.mjs update`,
    runByHand: () => " → run this command by hand and read what it writes to stderr",
    noInit: (label, why, stderrNote, old) =>
      `probe "${label}": the bridge did not answer initialize (${why}${stderrNote})${old}`,
    noList: (label, name, version, exited) =>
      `probe "${label}": initialize answered (${name} v${version}), tools/list did not (${exited ?? "silent"}) → run the command by hand and read its stderr`,
    answered: (label, name, version, tools) =>
      `probe "${label}": the bridge answered — ${name} v${version}, tools ${tools}`,
    schema: (tool, bad) =>
      `tool ${tool}: the schema carries ${bad} at the top level — the server hands out a schema the Anthropic API will reject ("input_schema does not support oneOf, allOf, or anyOf at the top level"), and the whole subagent run fails, not just this tool → the server fixes this, not the agent file or the bridge (the bridge passes the schema as is): tell the MCP server operator the tool name — whoever holds the address from the "server" line above — and wait for their update, then repeat doctor`,
    winKilled: (label, secs) =>
      `probe "${label}": the bridge did not leave on closed stdin within ${secs}s — killed forcibly → repeat doctor; if it was renewing the token, a login may be needed again`,
    sigKilled: (label, secs) =>
      `probe "${label}": the bridge left neither on closed stdin nor on SIGTERM within ${secs}s — killed with SIGKILL → repeat doctor; if it was renewing the token, a login may be needed again`,
  },
};
