// Слова doctor о файлах агентов (граф nks-dev: #6080): что не так с формой записи моста-спутника и метка строки-действия.
import { L } from "../shared/lang.ts";
import { type SatForm } from "./satform.ts";

/** Что не так с формой записи — и почему её заменяет единая. */
export const formWord = (form: Exclude<SatForm, "eval">): string => {
  switch (form) {
    case "eval-no-sep":
      return L(
        "--satellite стоит без `--` после кода `node -e` — node примет его за свой флаг («bad option») и не запустится",
        '--satellite stands without `--` after the `node -e` code — node takes it for its own flag ("bad option") and will not start',
      );
    case "eval-session":
      return L(
        "мост не увидит --satellite в своём argv (нет `--` перед ним или путь моста не положен в argv[1]) и встанет мостом сессии, не спутником",
        "the bridge will not see --satellite in its argv (no `--` before it, or the bridge path is not put into argv[1]) and will stand as a session bridge, not a satellite",
      );
    case "eval-other":
      return L(
        "код `node -e` не совпадает с эталонной формой записи — рабочей признаётся только она, сверенная живьём",
        "the `node -e` code does not match the reference form — only that form, verified live, is accepted as working",
      );
    case "shell":
      return L(
        "форма прежнего контракта (sh -c): на Windows sh нет, а переменных в args фронтматтера Claude Code не раскрывает",
        "the form of the former contract (sh -c): Windows has no sh, and Claude Code does not expand variables in frontmatter args",
      );
    case "path":
      return L(
        "путь к мосту записан прямо в args — машинный путь в общем файле, на другой машине его нет",
        "the bridge path is written straight into args — a machine path in a shared file, absent on another machine",
      );
    case "session":
      return L(
        "запись зовёт мост без --satellite — субагент встал бы мостом сессии, а не спутником",
        "the entry calls the bridge without --satellite — the subagent would stand as a session bridge, not a satellite",
      );
  }
};

/** Метка строки, которую надо исполнить: doctor гоняют, пока в разделе остаётся хоть одна (скилл iskronify). */
export const todo = (): string => L("НАДО:", "TODO:");
