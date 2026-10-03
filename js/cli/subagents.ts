// doctor, раздел «субагенты»: у каждого файла агента проекта свой мост-спутник,
// и этот мост на этой машине поднимается и отдаёт тулы, которые API примет.
// Поломка здесь не видна ни человеку, ни агенту: субагент без моста просто
// работает без тулов графа, а схема, которую API отвергает, роняет весь прогон
// ошибкой 400 без имени тула. Каждая находка — строка с готовым действием.
// Норма записи — skills/iskronify/references/delegation.md; форма — satform.ts.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";

import { CFG, isProductionServer } from "../bridge/config.ts";
import { loadStore, storePath } from "../bridge/store.ts";
import { homeBridgePath } from "../shared/home.ts";
import { L } from "../shared/lang.ts";
import { frontmatterText, parseFrontmatter, type YamlValue } from "./frontmatter.ts";
import { bridgePathOf, formOf, readyEntry, SATELLITE_ARGS, toolsTail } from "./satform.ts";
import { loginAdvice, probeSatellite } from "./satprobe.ts";
import { formWord, todo } from "./subwords.ts";

type Out = (s: string) => void;

/** ОС, под которую судится команда записи; переменная — шов проб (Windows на любой машине). */
const platform = (): string => process.env.ISKRON_DOCTOR_PLATFORM || process.platform;

const BRIDGE_RE = /iskron-bridge|(^|[\\/"'\s])iskron[^\\/"'\s]*\.mjs/;
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
  scope: "project" | "user";
  fm: Record<string, YamlValue>;
}

const str = (v: YamlValue | undefined): string => (typeof v === "string" ? v : "");

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
    return L(
      `доверие к папке принято для «${near}», а проект открыт как «${here}» — Claude Code сравнивает путь буква в букву (C:/ и c:/ — разные папки), и в недоверенной папке сервер из фронтматтера не поднимается без диалога → запусти claude в терминале из этой папки и прими диалог доверия либо открой папку тем же написанием пути`,
      `folder trust was accepted for "${near}", but the project is opened as "${here}" — Claude Code compares the path letter for letter (C:/ and c:/ are different folders), and in an untrusted folder the frontmatter server does not start without a dialog → run claude in a terminal from this folder and accept the trust dialog, or open the folder with the same spelling of the path`,
    );
  return L(
    `доверие к папке «${here}» и её родителям в ~/.claude.json не отмечено — в недоверенной папке сервер из фронтматтера не поднимается, и диалога об этом нет → запусти claude в этой папке и прими диалог доверия`,
    `trust for the folder "${here}" and its parents is not marked in ~/.claude.json — in an untrusted folder the frontmatter server does not start, and there is no dialog about it → run claude in this folder and accept the trust dialog`,
  );
}

/** Есть ли у машины вход, которым пробный спутник откроет сессию, — иначе проба лишь начала бы вход, которого никто не кончит. */
function hasGrant(): boolean {
  if (CFG.pat) return true;
  try {
    if (!existsSync(storePath())) return false;
    const t = loadStore().tokens;
    return Boolean(t?.access_token || t?.refresh_token);
  } catch {
    return false;
  }
}

interface Report {
  f: AgentFile;
  lines: string[];
  probe: Entry | null;
  names: string[];
}

export async function subagentsReport(out: Out): Promise<void> {
  const root = projectRoot();
  const userDir = join(homedir(), ".claude", "agents");
  // Из дома doctor зовут чаще всего: дом — не проект, его агенты — пользовательские.
  const atHome = resolve(root) === resolve(homedir());
  const project = atHome ? [] : agentFiles(join(root, ".claude", "agents"), "project");
  const shadowed = new Set(project.map((f) => f.agent));
  const user = agentFiles(userDir, "user");
  const claude = [...project, ...user.filter((f) => !shadowed.has(f.agent))];
  const opencode = [
    ...agentFiles(join(root, ".opencode", "agents"), "project"),
    ...agentFiles(join(root, ".opencode", "agent"), "project"),
  ];
  const osNote = process.env.ISKRON_DOCTOR_PLATFORM
    ? L(`ОС под суд: ${platform()}`, `OS under judgment: ${platform()}`)
    : platform();
  out(L(`субагенты: проект ${root} (${osNote})`, `subagents: project ${root} (${osNote})`));
  if (!claude.length && !opencode.length) {
    const dirs = `${join(root, ".claude", "agents")}, ${userDir}, ${join(root, ".opencode", "agents")}`;
    out(
      L(
        `  файлов агентов нет (${dirs}) — позови doctor из каталога проекта, если субагенты там`,
        `  no agent files (${dirs}) — call doctor from the project directory if the subagents are there`,
      ),
    );
    return;
  }
  for (const f of user.filter((f) => shadowed.has(f.agent)))
    out(
      L(
        `  ${f.path}: затенён файлом проекта с тем же именем «${f.agent}» — Claude Code берёт проектный`,
        `  ${f.path}: shadowed by the project file with the same name "${f.agent}" — Claude Code takes the project one`,
      ),
    );

  const parents = parentBridges(root);
  const required = parents.length ? parents : TEMPLATE_PARENTS;
  const byName = new Map<string, string[]>();
  const reports: Report[] = [];
  for (const f of claude) {
    const lines: string[] = [];
    const expected = `iskron-sub-${f.agent}`;
    const entries = entriesOf(f.fm);
    const ours = entries.filter((e) => BRIDGE_RE.test([e.command, ...e.args].join(" ")));
    const sat = ours.filter((e) => formOf(e) !== "session");
    let probeEntry: Entry | null = null;
    // Снимаемые мосты позвавшего — прежние строки файла плюс найденные на машине (или шаблон).
    const own = sat.map((e) => `mcp__${e.name}`);
    const disallowed = listOf(f.fm.disallowedTools).map((d) => d.replace(/__\*$/, ""));
    // Набор тулов записи (`--tools`) едет в готовый блок: замена формы его не теряет.
    const block = (name: string, e?: Entry) =>
      `${L("блоком ниже вместо прежних mcpServers и disallowedTools", "with the block below instead of the former mcpServers and disallowedTools")}:\n${readyEntry(
        name,
        [...new Set([...disallowed, ...required])].filter((p) => p !== `mcp__${name}`),
        e ? toolsTail(e) : [],
      )}`;
    const canonical = (e: Entry): Entry => ({
      name: `${e.name} ${L("(предложенная форма)", "(proposed form)")}`,
      ref: false,
      command: "node",
      args: [...SATELLITE_ARGS, ...toolsTail(e)],
      env: e.env,
    });
    const refs = entries.filter((e) => e.ref && /iskron/.test(e.name));
    for (const r of refs)
      lines.push(
        L(
          `запись «${r.name}» — ссылка на сервер из конфига сессии, не свой мост на прогон → замени встроенной записью, ${block(expected)}`,
          `entry "${r.name}" is a reference to a server from the session config, not its own bridge per run → replace it with an inline entry, ${block(expected)}`,
        ),
      );
    if (!sat.length) {
      if (ours.length)
        lines.push(
          L(
            `запись «${ours[0].name}»: ${formWord("session")} → ${block(expected, ours[0])}`,
            `entry "${ours[0].name}": ${formWord("session")} → ${block(expected, ours[0])}`,
          ),
        );
      else if (!refs.length)
        lines.push(
          L(
            `записи моста-спутника нет — у субагента нет тулов графа → вставь во фронтматтер ${block(expected)}`,
            `no satellite bridge entry — the subagent has no graph tools → insert into the frontmatter ${block(expected)}`,
          ),
        );
    }
    for (const e of sat) {
      byName.set(e.name, [...(byName.get(e.name) ?? []), f.path]);
      if (e.name === "iskron-sub")
        lines.push(
          L(
            `запись названа «iskron-sub» — общим именем прежнего контракта: второй файл с ним поведёт свои прогоны тем же процессом моста → переименуй запись в iskron-sub-${f.agent}`,
            `the entry is named "iskron-sub" — the shared name of the former contract: a second file with it would run its runs through the same bridge process → rename the entry to iskron-sub-${f.agent}`,
          ),
        );
      // Готовый блок несёт и своё имя: общее имя прежнего контракта в нём не повторяется.
      const name = e.name === "iskron-sub" ? expected : e.name;
      const form = formOf(e);
      if (form !== "eval") {
        lines.push(
          L(
            `запись «${e.name}»: ${formWord(form)} → замени ${block(name, e)}`,
            `entry "${e.name}": ${formWord(form)} → replace ${block(name, e)}`,
          ),
        );
        // Пробуем ту форму, что предложена взамен, — если домашний мост, который она зовёт, есть.
        if (!probeEntry && existsSync(homeBridgePath())) probeEntry = canonical(e);
        continue;
      }
      if (!which(e.command, root)) {
        lines.push(
          L(
            `команда записи «${e.name}» «${e.command}» на этой машине не находится (PATH) → поставь Node 22+ либо добавь каталог node в PATH: Claude Code запускает его по PATH`,
            `the command of entry "${e.name}" "${e.command}" is not found on this machine (PATH) → install Node 22+ or add the node directory to PATH: Claude Code launches it via PATH`,
          ),
        );
        continue;
      }
      const bridge = bridgePathOf(e);
      if (bridge && !existsSync(resolve(root, bridge))) {
        lines.push(
          L(
            `моста по пути записи нет: ${bridge} → поставь его (скилл establish-mcp кладёт домашнюю копию ${homeBridgePath()}), затем повтори doctor`,
            `no bridge at the entry path: ${bridge} → install it (the establish-mcp skill places a home copy at ${homeBridgePath()}), then repeat doctor`,
          ),
        );
        continue;
      }
      if (!probeEntry) probeEntry = e;
    }
    const need = required.filter((p) => !own.includes(p) && !disallowed.includes(p));
    if (sat.length && (need.length || !disallowed.length)) {
      const fix = [...new Set([...disallowed, ...required])]
        .filter((p) => !own.includes(p))
        .join(", ");
      lines.push(
        L(
          `мосты позвавшего не сняты (${need.join(", ") || "disallowedTools нет"}) — субагент унаследует их тулы, и его записи уйдут местом позвавшего → замени строку: disallowedTools: ${fix}`,
          `the caller's bridges are not removed (${need.join(", ") || "no disallowedTools"}) — the subagent would inherit their tools, and its writes would go out under the caller's seat → replace the line: disallowedTools: ${fix}`,
        ),
      );
    }
    for (const o of own.filter((o) => disallowed.includes(o)))
      lines.push(
        L(
          `disallowedTools снимает свой же мост ${o} → убери ${o} из disallowedTools`,
          `disallowedTools removes the entry's own bridge ${o} → remove ${o} from disallowedTools`,
        ),
      );
    reports.push({ f, lines, probe: probeEntry, names: sat.map((e) => e.name) });
  }
  for (const [name, files] of byName) {
    if (files.length < 2) continue;
    for (const r of reports.filter((r) => files.includes(r.f.path)))
      r.lines.push(
        L(
          `имя записи «${name}» делят ${files.length} файла(ов): ${files.join(", ")} — Claude Code держит одно соединение на имя записи, их прогоны пойдут одним процессом моста, и первый закончивший погасит место другим → переименуй запись в этом файле: iskron-sub-${r.f.agent}`,
          `the entry name "${name}" is shared by ${files.length} file(s): ${files.join(", ")} — Claude Code keeps one connection per entry name, their runs would go through one bridge process, and the first to finish would put out the seat for the others → rename the entry in this file: iskron-sub-${r.f.agent}`,
        ),
      );
  }
  // Без входа проба лишь начала бы вход, который никто не кончит (регистрация клиента, замок входа):
  // её не зовём и говорим, как войти.
  const grant = hasGrant();
  let noGrantSaid = false;
  // Одна команда — одна проба: те же байты моста отвечают всем файлам одинаково.
  const probed = new Map<string, { label: string; failed: boolean }>();
  for (const r of reports) {
    // Проба — до заголовка: файл «в порядке», только если и его строки, и проба чисты,
    // иначе цикл «doctor до раздела без НАДО:» кончался бы при сломанном субагенте.
    const seen: string[] = [];
    if (r.probe && !grant) {
      r.lines.push(
        noGrantSaid
          ? L(
              "проба спутника не шла — входа в граф на этой машине нет (действие — строкой выше)",
              "the satellite probe did not run — there is no graph login on this machine (the action is in the line above)",
            )
          : L(
              `проба спутника не шла — входа в граф на этой машине нет → ${loginAdvice()}`,
              `the satellite probe did not run — there is no graph login on this machine → ${loginAdvice()}`,
            ),
      );
      noGrantSaid = true;
    } else if (r.probe) {
      const key = JSON.stringify([r.probe.command, r.probe.args, r.probe.env]);
      const first = probed.get(key);
      if (first) {
        if (first.failed)
          r.lines.push(
            L(
              `проба той же команды, что у «${first.label}», не прошла — действие выше`,
              `the probe of the same command as "${first.label}" failed — the action is above`,
            ),
          );
        else
          seen.push(
            L(
              `проба: та же команда, что у «${first.label}» выше`,
              `probe: the same command as "${first.label}" above`,
            ),
          );
      } else {
        const res = await probeSatellite(r.probe.name, r.probe, root);
        probed.set(key, { label: r.probe.name, failed: res.findings.length > 0 });
        seen.push(...res.lines);
        r.lines.push(...res.findings);
      }
    }
    const where = r.f.scope === "user" ? L(" (пользовательский)", " (user)") : "";
    const named = r.names.length
      ? L(`запись «${r.names.join("», «")}»`, `entry "${r.names.join('", "')}"`)
      : L("без записи моста-спутника", "no satellite bridge entry");
    out(`  ${r.f.path}${where}: ${named}${r.lines.length ? "" : L(" — в порядке", " — fine")}`);
    for (const l of seen) out(`    ${l}`);
    // Готовый блок — строками с отступом в шесть пробелов: сняв их, его вставляют во фронтматтер.
    for (const l of r.lines) {
      const [head, ...rest] = l.split("\n");
      out(`    ${todo()} ${head}`);
      for (const b of rest) out(`      ${b}`);
    }
  }
  if (claude.length) {
    const t = trustLine(root);
    if (t && project.length) out(`  ${todo()} ${t}`);
  }
  for (const f of opencode) {
    const keys = Object.keys(f.fm).filter((k) => k === "mcpServers" || k === "mcp");
    const keyNote = keys.length
      ? L(
          `; НАДО: ключ ${keys.join(", ")} OpenCode в файле агента не читает → убери его`,
          `; TODO: the key ${keys.join(", ")} is not read by OpenCode in an agent file → remove it`,
        )
      : "";
    out(
      L(
        `  ${f.path}: OpenCode — мост-спутник даёт дочерней сессии плагин поставки (строка OpenCode выше), записи в файле не нужно${keyNote}`,
        `  ${f.path}: OpenCode — the delivery plugin gives the child session a satellite bridge (the OpenCode line above), no entry is needed in the file${keyNote}`,
      ),
    );
  }
}
