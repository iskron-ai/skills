// use — постоянный выбор адреса сервера на этой машине (граф nks-dev: #5040):
// `ru` — mcp.iskron.ru, `en` — mcp.iskron.ai, иначе полный URL другого
// инстанса. Пишется файлом рядом с грантом; мост читает его при пустом
// аргументе и пустом окружении — так выбор доезжает и до плагинной записи,
// которая аргументов не несёт. Грант у моста раздельный по хосту: смена
// адреса — новый вход.
import {
  CFG,
  parseArgs,
  resolveServerChoice,
  setConfig,
  writeServerChoice,
} from "../bridge/config.ts";
import { freshnessWord } from "./doctor.ts";

const out = (s: string): void => {
  process.stdout.write(s + "\n");
};

export function runUse(argv: string[]): void {
  let word: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--auth-dir") rest.push(a, argv[++i] ?? "");
    else if (a.startsWith("--") || word) rest.push(a);
    else word = a;
  }
  setConfig(parseArgs(rest));
  const url = word ? resolveServerChoice(word) : null;
  if (!url) {
    out("use: назови адрес — en (mcp.iskron.ai), ru (mcp.iskron.ru) или полный URL инстанса");
    process.exitCode = 2;
    return;
  }
  const path = writeServerChoice(CFG.authDir, url);
  out(`мост смотрит на ${url} — записано в ${path}; ${freshnessWord(url)}`);
  out(
    "Действует с нового процесса моста: перезапусти сессии харнеса. Грант раздельный по адресу — первый вызов на новом адресе ведёт во вход.",
  );
}
