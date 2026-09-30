// doctor, раздел «субагенты»: у каждого файла агента проекта свой мост-спутник,
// и этот мост на этой машине поднимается и отдаёт тулы, которые API примет.
// Поломка здесь не видна ни человеку, ни агенту: субагент без моста просто
// работает без тулов графа, а схема, которую API отвергает, роняет весь прогон
// ошибкой 400 без имени тула. Каждая находка — строка с готовым действием.
// Норма записи — skills/iskronify/references/delegation.md.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { CFG, isProductionServer } from "../bridge/config.ts";
import { homeBridgePath } from "../shared/home.ts";
import { frontmatterText, parseFrontmatter, type YamlValue } from "./frontmatter.ts";
import { probeSatellite } from "./satprobe.ts";

type Out = (s: string) => void;

/** ОС, под которую судится команда записи; переменная — шов проб (Windows на любой машине). */
const platform = (): string => process.env.ISKRON_DOCTOR_PLATFORM || process.platform;

const BRIDGE_RE = /iskron-bridge|(^|[\\/"'\s])iskron[^\\/"'\s]*\.mjs/;
const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);
/** Префиксы серверов графа в шаблоне проекции — снимаются всегда, когда своих не нашлось. */
const TEMPLATE_PARENTS = ["mcp__iskron-bridge", "mcp__plugin_iskron_iskron", "mcp__iskron"];

interface Entry {
  name: string;
  ref: boolean; // строка-ссылка на сервер конфига сессии, не встроенная запись
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface AgentFile {
  path: string;
  agent: string;
  scope: "проект" | "пользователь";
  fm: Record<string, YamlValue>;
}

const str = (v: YamlValue | undefined): string => (typeof v === "string" ? v : "");
const q = (s: string): string => JSON.stringify(s);

function entriesOf(fm: Record<string, YamlValue>): Entry[] {
  const raw = fm.mcpServers;
  const pairs: [string, YamlValue][] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") pairs.push([item, null]);
      else if (item && typeof item === "object" && !Array.isArray(item))
        for (const [k, v] of Object.entries(item)) pairs.push([k, v]);
    }
  } else if (raw && typeof raw === "object") pairs.push(...Object.entries(raw));
  return pairs.map(([name, v]) => {
    const spec = v && typeof v === "object" && !Array.isArray(v) ? v : {};
    const args = Array.isArray(spec.args) ? spec.args.map((a) => str(a)) : [];
    const env: Record<string, string> = {};
    if (spec.env && typeof spec.env === "object" && !Array.isArray(spec.env))
      for (const [k, e] of Object.entries(spec.env)) env[k] = str(e);
    return { name, ref: v === null, command: str(spec.command), args, env };
  });
}

const listOf = (v: YamlValue | undefined): string[] =>
  Array.isArray(v)
    ? v.map((x) => str(x).trim()).filter(Boolean)
    : str(v)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

function agentFiles(dir: string, scope: AgentFile["scope"]): AgentFile[] {
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  return names.sort().map((f) => {
    const path = join(dir, f);
    let fm: Record<string, YamlValue> = {};
    try {
      const text = frontmatterText(readFileSync(path, "utf8"));
      if (text !== null) fm = parseFrontmatter(text);
    } catch {}
    return { path, agent: str(fm.name) || basename(f, ".md"), scope, fm };
  });
}

/** Корень проекта: первый каталог вверх от cwd с файлами агентов, иначе с .git, иначе cwd; дом — не проект. */
function projectRoot(): string {
  const home = resolve(homedir());
  let gitRoot: string | null = null;
  for (let d = process.cwd(); ;) {
    if (resolve(d) === home) break;
    if (existsSync(join(d, ".claude", "agents")) || existsSync(join(d, ".opencode", "agents")))
      return d;
    if (!gitRoot && existsSync(join(d, ".git"))) gitRoot = d;
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return gitRoot ?? process.cwd();
}

/** Где на этой машине лежит команда; null — не нашлась. */
function which(cmd: string, cwd: string): string | null {
  if (isAbsolute(cmd) || /[\\/]/.test(cmd)) {
    const p = resolve(cwd, cmd);
    return existsSync(p) ? p : null;
  }
  const exts =
    platform() === "win32"
      ? ["", ...(process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)]
      : [""];
  for (const dir of (process.env.PATH || "").split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = join(dir, cmd + ext);
      try {
        if (statSync(p).isFile()) return p;
      } catch {}
    }
  }
  return null;
}

/** node этой машины абсолютным путём — для записи, которой оболочка не нужна. */
function nodePath(cwd: string): string {
  if (/^node(\.exe)?$/i.test(basename(process.execPath))) return process.execPath;
  return which("node", cwd) ?? "node";
}

/**
 * Готовый блок записи моста-спутника для ОС этой машины — блочной формой YAML,
 * той же, что пишет проекция и читает этот doctor: вставленный вместо прежних
 * mcpServers и disallowedTools, он на повторе не даёт ни одной строки «НАДО:».
 */
export function readyEntry(name: string, cwd: string, disallowed: string[]): string {
  const [command, args] =
    platform() === "win32"
      ? [q(nodePath(cwd)), `[${q(homeBridgePath())}, "--satellite"]`]
      : ["sh", `["-c", ${q('exec node "$HOME/.iskron-bridge/iskron-bridge.mjs" --satellite')}]`];
  return [
    "mcpServers:",
    `  - ${name}:`,
    "      type: stdio",
    `      command: ${command}`,
    `      args: ${args}`,
    `disallowedTools: ${disallowed.join(", ")}`,
  ].join("\n");
}

/** Как держать машинный файл агента вне общего репо: отслеживаемый — skip-worktree, новый — локальный exclude. */
function keepLocal(path: string, root: string): string {
  const rel = relative(root, path).replace(/\\/g, "/");
  if (rel.startsWith("..")) return "файл пользовательский, в репо не входит";
  let tracked = false;
  try {
    tracked =
      spawnSync("git", ["ls-files", "--error-unmatch", rel], { cwd: root, stdio: "ignore" })
        .status === 0;
  } catch {}
  return tracked
    ? `git update-index --skip-worktree ${rel} (правка остаётся локальной; сменится общий файл — git pull откажет на нём: git update-index --no-skip-worktree ${rel}, git stash, pull, верни строку и снова --skip-worktree)`
    : `добавь строку ${rel} в .git/info/exclude`;
}

/** Путь к мосту, который зовёт запись, с раскрытым домом — как его увидит оболочка. */
function bridgePathOf(e: Entry): string | null {
  const hay = [e.command, ...e.args].join(" ");
  // Путь, собранный самим node из домашнего каталога (`node -e` с os.homedir()), — дом этой машины.
  if (/homedir\(\)/.test(hay) && /\.iskron-bridge/.test(hay)) return homeBridgePath();
  const m =
    /(?:"([^"]*iskron[^"]*\.mjs)"|'([^']*iskron[^']*\.mjs)'|([^\s"']*iskron[^\s"']*\.mjs))/.exec(
      hay,
    );
  const raw = m?.[1] ?? m?.[2] ?? m?.[3];
  if (!raw) return null;
  return raw
    .replace(/^~(?=[\\/])/, homedir())
    .replace(/\$\{HOME\}|\$HOME|%USERPROFILE%|\$\{USERPROFILE\}|\$USERPROFILE/g, homedir());
}

/** Адрес — сервер графа: продовый (русский или английский) либо тот, на который смотрит мост этой машины. */
function graphServer(url: string): boolean {
  const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  return isProductionServer(url) || norm(url) === norm(CFG.serverUrl);
}

/** Серверы моста, которые субагент унаследует от позвавшего: их тулы надо снять disallowedTools. */
function parentBridges(root: string): string[] {
  const found = new Set<string>();
  const scan = (servers: unknown, prefix: (n: string) => string) => {
    if (!servers || typeof servers !== "object") return;
    for (const [n, v] of Object.entries(servers as Record<string, unknown>)) {
      const e = (v ?? {}) as { command?: string; args?: string[]; url?: string };
      const hay = [e.command ?? "", ...(e.args ?? [])].join(" ");
      if (BRIDGE_RE.test(hay) && !hay.includes("--satellite")) found.add(prefix(n));
      // Нативная http-запись на сервер графа — те же тулы графа у субагента, снимаются так же.
      else if (typeof e.url === "string" && graphServer(e.url)) found.add(prefix(n));
    }
  };
  const readJson = (p: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const user = readJson(join(homedir(), ".claude.json"));
  if (user) {
    scan(user.mcpServers, (n) => `mcp__${n}`);
    const projects = (user.projects ?? {}) as Record<string, { mcpServers?: unknown }>;
    const key = root.replace(/\\/g, "/");
    for (const [k, p] of Object.entries(projects))
      if (k.replace(/\\/g, "/") === key) scan(p.mcpServers, (n) => `mcp__${n}`);
  }
  scan(readJson(join(root, ".mcp.json"))?.mcpServers, (n) => `mcp__${n}`);
  const registry = readJson(join(homedir(), ".claude", "plugins", "installed_plugins.json"));
  const plugins = (registry?.plugins ?? {}) as Record<string, { installPath?: string }[]>;
  for (const [key, installs] of Object.entries(plugins)) {
    const plugin = key.split("@")[0];
    if (!/iskron/.test(plugin)) continue;
    for (const inst of installs)
      if (inst.installPath)
        scan(
          readJson(join(inst.installPath, ".mcp.json"))?.mcpServers,
          (n) => `mcp__plugin_${plugin}_${n}`,
        );
  }
  return [...found];
}

/** Доверие к папке: сервер из фронтматтера в недоверенной папке не поднимается, и диалога нет. */
function trustLine(root: string): string | null {
  let cfg: { projects?: Record<string, { hasTrustDialogAccepted?: boolean }> };
  try {
    cfg = JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf8")) as typeof cfg;
  } catch {
    return null;
  }
  const keys = Object.entries(cfg.projects ?? {})
    .filter(([, p]) => p?.hasTrustDialogAccepted)
    .map(([k]) => k.replace(/\\/g, "/").replace(/\/+$/, ""));
  const here = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const chain: string[] = [];
  for (let d = here; ;) {
    chain.push(d);
    const up = d.slice(0, d.lastIndexOf("/"));
    if (!up || up === d) break;
    d = up;
  }
  if (chain.some((d) => keys.includes(d))) return null;
  const near = keys.find((k) => chain.some((d) => d.toLowerCase() === k.toLowerCase()));
  if (near)
    return `доверие к папке принято для «${near}», а проект открыт как «${here}» — Claude Code сравнивает путь буква в букву (C:/ и c:/ — разные папки), и в недоверенной папке сервер из фронтматтера не поднимается без диалога → запусти claude в терминале из этой папки и прими диалог доверия либо открой папку тем же написанием пути`;
  return `доверие к папке «${here}» и её родителям в ~/.claude.json не отмечено — в недоверенной папке сервер из фронтматтера не поднимается, и диалога об этом нет → запусти claude в этой папке и прими диалог доверия`;
}

export async function subagentsReport(out: Out): Promise<void> {
  const root = projectRoot();
  const userDir = join(homedir(), ".claude", "agents");
  // Из дома doctor зовут чаще всего: дом — не проект, его агенты — пользовательские.
  const atHome = resolve(root) === resolve(homedir());
  const project = atHome ? [] : agentFiles(join(root, ".claude", "agents"), "проект");
  const shadowed = new Set(project.map((f) => f.agent));
  const user = agentFiles(userDir, "пользователь");
  const claude = [...project, ...user.filter((f) => !shadowed.has(f.agent))];
  const opencode = [
    ...agentFiles(join(root, ".opencode", "agents"), "проект"),
    ...agentFiles(join(root, ".opencode", "agent"), "проект"),
  ];
  out(
    `субагенты: проект ${root} (${process.env.ISKRON_DOCTOR_PLATFORM ? `ОС под суд: ${platform()}` : platform()})`,
  );
  if (!claude.length && !opencode.length) {
    out(
      `  файлов агентов нет (${join(root, ".claude", "agents")}, ${userDir}, ${join(root, ".opencode", "agents")}) — позови doctor из каталога проекта, если субагенты там`,
    );
    return;
  }
  for (const f of user.filter((f) => shadowed.has(f.agent)))
    out(
      `  ${f.path}: затенён файлом проекта с тем же именем «${f.agent}» — Claude Code берёт проектный`,
    );

  const parents = parentBridges(root);
  const byName = new Map<string, string[]>();
  const reports: { f: AgentFile; lines: string[]; probe: Entry | null; names: string[] }[] = [];
  for (const f of claude) {
    const lines: string[] = [];
    const expected = `iskron-sub-${f.agent}`;
    const entries = entriesOf(f.fm);
    const ours = entries.filter((e) => BRIDGE_RE.test([e.command, ...e.args].join(" ")));
    const sat = ours.filter((e) => [e.command, ...e.args].join(" ").includes("--satellite"));
    let probeEntry: Entry | null = null;
    // Снимаемые мосты позвавшего — прежние строки файла плюс найденные на машине (или шаблон).
    const own = sat.map((e) => `mcp__${e.name}`);
    const disallowed = listOf(f.fm.disallowedTools).map((d) => d.replace(/__\*$/, ""));
    const required = parents.length ? parents : TEMPLATE_PARENTS;
    const block = (name: string) =>
      `блоком ниже вместо прежних mcpServers и disallowedTools:\n${readyEntry(
        name,
        root,
        [...new Set([...disallowed, ...required])].filter((p) => p !== `mcp__${name}`),
      )}`;
    const refs = entries.filter((e) => e.ref && /iskron/.test(e.name));
    for (const r of refs)
      lines.push(
        `запись «${r.name}» — ссылка на сервер из конфига сессии, не свой мост на прогон → замени встроенной записью, ${block(expected)}`,
      );
    if (!sat.length) {
      if (ours.length)
        lines.push(
          `запись «${ours[0].name}» зовёт мост без --satellite — субагент встал бы местом сессии, а не спутником → ${block(expected)}`,
        );
      else if (!refs.length)
        lines.push(
          `записи моста-спутника нет — у субагента нет тулов графа → вставь во фронтматтер ${block(expected)}`,
        );
    }
    for (const e of sat) {
      byName.set(e.name, [...(byName.get(e.name) ?? []), f.path]);
      if (e.name === "iskron-sub")
        lines.push(
          `запись названа «iskron-sub» — общим именем прежнего контракта: второй файл с ним поведёт свои прогоны тем же процессом моста → переименуй запись в iskron-sub-${f.agent}`,
        );
      const shown = [e.command, ...e.args].join(" ");
      const cmdBase = basename(e.command).replace(/\.exe$/i, "");
      // Готовая строка несёт и своё имя: общее имя прежнего контракта в ней не повторяется.
      const ready = block(e.name === "iskron-sub" ? expected : e.name);
      let runnable = true;
      if (!which(e.command, root)) {
        runnable = false;
        lines.push(
          platform() === "win32" && SHELLS.has(cmdBase)
            ? `запись «${e.name}» запускает мост через ${e.command} — на Windows ${e.command} нет (в PATH не нашёлся), а Claude Code не раскрывает $HOME в args фронтматтера; файл станет машинным, в общий репо его не коммить: ${keepLocal(f.path, root)} → замени путями этой машины ${ready}`
            : `команда записи «${e.name}» «${e.command}» на этой машине не находится (PATH) → ${ready}`,
        );
      } else if (
        !SHELLS.has(cmdBase) &&
        e.args.some((a) => /\$\{?[A-Za-z_]|%[A-Za-z_]+%/.test(a))
      ) {
        runnable = false;
        lines.push(
          `запись «${e.name}» несёт переменную в args (${shown}) — Claude Code её не раскрывает, node получит буквальный путь → замени ${ready}`,
        );
      }
      const bridge = bridgePathOf(e);
      if (bridge && !existsSync(resolve(root, bridge)))
        lines.push(
          `моста по пути записи нет: ${bridge} → поставь его (скилл establish-mcp кладёт домашнюю копию ${homeBridgePath()}) либо поправь путь`,
        );
      else if (runnable && !probeEntry) probeEntry = e;
      else if (
        !runnable &&
        bridge &&
        platform() === "win32" &&
        existsSync(homeBridgePath()) &&
        !probeEntry
      )
        // Запись не исполнима здесь — пробуем ту, что предложена взамен.
        probeEntry = {
          name: `${e.name} (предложенная форма)`,
          ref: false,
          command: nodePath(root),
          args: [homeBridgePath(), "--satellite"],
          env: e.env,
        };
    }
    const need = required.filter((p) => !own.includes(p) && !disallowed.includes(p));
    if (sat.length && (need.length || !disallowed.length))
      lines.push(
        `мосты позвавшего не сняты (${need.join(", ") || "disallowedTools нет"}) — субагент унаследует их тулы, и его записи уйдут местом позвавшего → замени строку: disallowedTools: ${[...new Set([...disallowed, ...required])].filter((p) => !own.includes(p)).join(", ")}`,
      );
    for (const o of own.filter((o) => disallowed.includes(o)))
      lines.push(`disallowedTools снимает свой же мост ${o} → убери ${o} из disallowedTools`);
    reports.push({ f, lines, probe: probeEntry, names: sat.map((e) => e.name) });
  }
  for (const [name, files] of byName) {
    if (files.length < 2) continue;
    for (const r of reports.filter((r) => files.includes(r.f.path)))
      r.lines.push(
        `имя записи «${name}» делят ${files.length} файла(ов): ${files.join(", ")} — Claude Code держит одно соединение на имя записи, их прогоны пойдут одним процессом моста, и первый закончивший погасит место другим → переименуй запись в этом файле: iskron-sub-${r.f.agent}`,
      );
  }
  const probed = new Map<string, string[]>();
  for (const r of reports) {
    const where = r.f.scope === "пользователь" ? " (пользовательский)" : "";
    out(
      `  ${r.f.path}${where}: ${r.names.length ? `запись «${r.names.join("», «")}»` : "без записи моста-спутника"}${r.lines.length ? "" : " — в порядке"}`,
    );
    // Готовый блок — строками с отступом в шесть пробелов: сняв их, его вставляют во фронтматтер.
    for (const l of r.lines) {
      const [head, ...rest] = l.split("\n");
      out(`    НАДО: ${head}`);
      for (const b of rest) out(`      ${b}`);
    }
    if (!r.probe) continue;
    // Одна команда — одна проба: те же байты моста отвечают всем файлам одинаково.
    const key = JSON.stringify([r.probe.command, r.probe.args, r.probe.env]);
    const first = probed.get(key);
    if (first) {
      out(`    проба: та же команда, что у «${first[0]}» выше`);
      continue;
    }
    probed.set(key, [r.probe.name]);
    for (const l of await probeSatellite(r.probe.name, r.probe, root)) out(`    ${l}`);
  }
  if (claude.length) {
    const t = trustLine(root);
    if (t && project.length) out(`  НАДО: ${t}`);
  }
  for (const f of opencode) {
    const keys = Object.keys(f.fm).filter((k) => k === "mcpServers" || k === "mcp");
    out(
      `  ${f.path}: OpenCode — мост-спутник даёт дочерней сессии плагин поставки (строка OpenCode выше), записи в файле не нужно${keys.length ? `; НАДО: ключ ${keys.join(", ")} OpenCode в файле агента не читает → убери его` : ""}`,
    );
  }
}
