// Исполнима ли команда записи моста (граф nks-dev: #6727, spawn ENOENT): харнесс
// ищет её в PATH СВОЕЙ среды, а doctor видит PATH оболочки, из которой позван, —
// среду харнесса отсюда не прочесть. Что видно — говорится как факт; чего не
// видно — так и говорится; ход починки называется точной командой.
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute } from "node:path";

import { envName } from "../delivery/index.ts";
import { homeBridgePath } from "../shared/home.ts";
import { L } from "../shared/lang.ts";
import { which } from "./subagents.ts";
import { todo } from "./subwords.ts";

export interface Launch {
  who: string;
  harness: "claude" | "codex";
  command: string;
  /** Имя ручной записи в пользовательском конфиге — её и переписывать; у плагинной нет. */
  entry?: string;
}

const platform = (): string => process.env[envName("DOCTOR_PLATFORM")] || process.platform;

// Каталоги, которые есть в PATH и у процесса, запущенного не из оболочки:
// launchd на macOS даёт /usr/bin:/bin:/usr/sbin:/sbin, Linux-сессия — и /usr/local/bin.
const SYSTEM_DIRS: Record<string, string[]> = {
  darwin: ["/usr/bin", "/bin", "/usr/sbin", "/sbin"],
  linux: ["/usr/local/bin", "/usr/bin", "/bin"],
};

const executable = (p: string): boolean => {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

function fix(l: Launch, node: string | null): string {
  const bridge = homeBridgePath().replace(homedir(), "$HOME");
  const abs =
    node ?? L("<абсолютный путь к node: command -v node>", "<absolute node path: command -v node>");
  const shell = L(
    "запускай харнесс из оболочки, где node находится",
    "start the harness from a shell where node is found",
  );
  // Ход не ставит второго моста рядом с первым: ручная запись переписывается на месте,
  // плагинная Claude Code заменяется ручной и выключается; Codex выключить запись плагина
  // не даёт — ему только оболочка (#6728: два пути — дефект).
  const abs_ =
    l.harness === "codex"
      ? L(
          "плагинной записи Codex абсолютного пути не вписать, а вторая запись рядом дала бы два моста",
          "the Codex plugin entry takes no absolute path, and a second entry beside it would make two bridges",
        )
      : L(
          `либо запись с абсолютным путём к node, от PATH не зависящая: ${l.entry ? `claude mcp remove "${l.entry}" --scope user, затем ` : ""}claude mcp add --scope user "${l.entry ?? "iskron-bridge"}" -- ${abs} "${bridge}"${l.entry ? "" : " — и выключи запись плагина plugin:iskron:iskron в /mcp, чтобы мост был один"}; путь привязан к этой установке node — сменишь её, перепиши запись`,
          `or an entry with the absolute node path, independent of PATH: ${l.entry ? `claude mcp remove "${l.entry}" --scope user, then ` : ""}claude mcp add --scope user "${l.entry ?? "iskron-bridge"}" -- ${abs} "${bridge}"${l.entry ? "" : " — and disable the plugin entry plugin:iskron:iskron in /mcp so the bridge is one"}; the path is tied to this node install — change it, rewrite the entry`,
        );
  return L(`    ход: ${shell}; ${abs_}`, `    fix: ${shell}; ${abs_}`);
}

/** Команда каждой stdio-записи моста: найдена ли, где, и увидит ли её харнесс, запущенный не из оболочки. */
export function launchReport(out: (s: string) => void, launches: Launch[]): void {
  for (const l of launches) {
    const cmd = l.command || "node";
    const found = which(cmd, process.cwd());
    if (!found || !executable(found)) {
      out(
        L(
          `${todo()} ${l.who}: команда «${cmd}» не найдена${isAbsolute(cmd) ? "" : " в PATH этой оболочки"} или не исполнима — харнесс мост не поднимет (spawn ENOENT)`,
          `${todo()} ${l.who}: the command "${cmd}" is not found${isAbsolute(cmd) ? "" : " in this shell's PATH"} or not executable — the harness will not raise the bridge (spawn ENOENT)`,
        ),
      );
      const own = /^node/i.test(basename(process.execPath)) ? process.execPath : null;
      out(fix(l, own));
      continue;
    }
    if (isAbsolute(cmd)) {
      out(
        L(
          `${l.who}: команда ${cmd} — исполнима, от PATH не зависит`,
          `${l.who}: the command ${cmd} is executable and independent of PATH`,
        ),
      );
      continue;
    }
    const dir = dirname(found);
    const system = SYSTEM_DIRS[platform()];
    if (!system || system.includes(dir)) {
      out(L(`${l.who}: «${cmd}» → ${found}`, `${l.who}: "${cmd}" → ${found}`));
      continue;
    }
    out(
      L(
        `${l.who}: «${cmd}» → ${found} — в PATH этой оболочки; каталог ${dir} кладёт туда профиль оболочки или менеджер версий, и харнесс, запущенный не из оболочки (приложение, сервис), его может не увидеть. Какой PATH у харнесса, отсюда не видно; пишет харнесс spawn ENOENT — ход строкой ниже`,
        `${l.who}: "${cmd}" → ${found} — in this shell's PATH; the directory ${dir} is put there by the shell profile or a version manager, and a harness started outside a shell (an app, a service) may not see it. The harness's PATH cannot be seen from here; if the harness says spawn ENOENT — the fix is on the next line`,
      ),
    );
    out(fix(l, found));
  }
}

export const openCodeRuntimeWord = (): string =>
  L(
    "OpenCode: мост плагина бежит на рантайме самого OpenCode — от node в PATH не зависит",
    "OpenCode: the plugin's bridge runs on OpenCode's own runtime — independent of node in PATH",
  );
