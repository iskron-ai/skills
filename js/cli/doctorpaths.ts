// Второй путь к тому же серверу рядом с мостом (граф nks-dev: #6728): http-запись
// на сервер графа в конфиге харнесса или коннектор claude.ai — тулы двоятся, а
// записи этого пути уходят без места. Путь к графу один — мост; запись в конфиге —
// строка «НАДО» с ходом; коннектор виден только по истории подключений, которая не
// гаснет после снятия, — строкой без «НАДО», с ходом. Записи OpenCode называет opencode-config.ts.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { CONNECTOR_PATTERN } from "../delivery/index.ts";
import { L } from "../shared/lang.ts";
import { graphServer, projectRoot } from "./subagents.ts";
import { todo } from "./subwords.ts";

type Out = (s: string) => void;

const readJson = (p: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const httpEntries = (servers: unknown): [string, string][] =>
  Object.entries((servers ?? {}) as Record<string, { url?: unknown }>)
    .filter(([, v]) => typeof v?.url === "string" && graphServer(v.url))
    .map(([n, v]) => [n, String(v.url)]);

const say = (out: Out, where: string, name: string, url: string, remove: string): void =>
  out(
    L(
      `${todo()} ${where}: запись «${name}» ведёт ${url} напрямую по http, мимо моста — второй путь к тому же серверу: тулы двоятся, записи этого пути уходят без места. Путь к графу один — мост → убери её: ${remove}`,
      `${todo()} ${where}: the entry "${name}" leads to ${url} directly over http, around the bridge — a second path to the same server: the tools double, and writes on this path go out without a seat. The one path to the graph is the bridge → remove it: ${remove}`,
    ),
  );

// Коннектор claude.ai Claude Code приносит в каждую сессию; его адреса на диске
// нет — только имя, под которым он подключался. Имя Искрона — повод проверить.
const CONNECTOR_RE = CONNECTOR_PATTERN;

function claudeCode(out: Out): void {
  const file = join(homedir(), ".claude.json");
  const cfg = readJson(file);
  if (!cfg) return;
  for (const [n, url] of httpEntries(cfg.mcpServers))
    say(out, `Claude Code (${file})`, n, url, `claude mcp remove "${n}" --scope user`);
  const projects = (cfg.projects ?? {}) as Record<string, { mcpServers?: unknown }>;
  for (const [dir, p] of Object.entries(projects))
    for (const [n, url] of httpEntries(p?.mcpServers))
      say(
        out,
        `Claude Code (${file}, ${dir})`,
        n,
        url,
        `cd "${dir}" && claude mcp remove "${n}" --scope local`,
      );
  const mcp = join(projectRoot(), ".mcp.json");
  for (const [n, url] of httpEntries(readJson(mcp)?.mcpServers))
    say(out, `Claude Code (${mcp})`, n, url, L(`удали её из ${mcp}`, `delete it from ${mcp}`));
  const ever = Array.isArray(cfg.claudeAiMcpEverConnected) ? cfg.claudeAiMcpEverConnected : [];
  for (const c of ever.map(String).filter((c) => CONNECTOR_RE.test(c)))
    out(
      L(
        `Claude Code: коннектор «${c}» в истории подключений (${file}, claudeAiMcpEverConnected; строка останется и после снятия) — коннекторы claude.ai приходят в каждую сессию Claude Code рядом с мостом, а адреса коннектора на диске нет. Если он стоит и ведёт на сервер графа — это второй путь мимо моста → убери его в claude.ai (Настройки → Коннекторы) или выключи в Claude Code (/mcp)`,
        `Claude Code: the connector "${c}" is in the connection history (${file}, claudeAiMcpEverConnected; the line stays after removal) — claude.ai connectors come into every Claude Code session next to the bridge, and the connector's address is not on disk. If it is installed and leads to the graph server, it is a second path around the bridge → remove it in claude.ai (Settings → Connectors) or disable it in Claude Code (/mcp)`,
      ),
    );
}

/** [mcp_servers.<имя>] с url = "…" в config.toml Codex — без разбора TOML целиком. */
function codexHttp(text: string): [string, string][] {
  const found: [string, string][] = [];
  let section: string | null = null;
  for (const line of text.split("\n")) {
    const head = /^\s*\[mcp_servers\.(?:"([^"]+)"|([^\]\s.]+))\]\s*$/.exec(line);
    if (head) section = head[1] ?? head[2] ?? null;
    else if (/^\s*\[/.test(line)) section = null;
    const url = /^\s*url\s*=\s*"([^"]+)"/.exec(line)?.[1];
    if (section && url && graphServer(url)) found.push([section, url]);
  }
  return found;
}

export function secondPathReport(out: Out, codexHomes: string[]): void {
  claudeCode(out);
  for (const home of codexHomes) {
    const file = join(home, "config.toml");
    if (!existsSync(file)) continue;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const [n, url] of codexHttp(text))
      say(out, `Codex (${file})`, n, url, `codex mcp remove "${n}"`);
  }
}
