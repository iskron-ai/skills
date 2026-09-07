// doctor — одна команда на машине пользователя, отвечающая «какая сборка стоит
// и работает ли она». Читает и не пишет: ни в хранилище гранта, ни в лог.
// Каждая строка — факт, наблюдённый здесь и сейчас, с названным путём.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BUILD } from "../bridge/build.ts";
import { now } from "../bridge/clock.ts";
import { CFG, parseArgs, setConfig } from "../bridge/config.ts";
import { errorMessage } from "../bridge/errors.ts";
import { discoverMeta } from "../bridge/oauth/discovery.ts";
import { grantLogPath, loadGrantState, loadStore, storePath } from "../bridge/store.ts";
import { refreshHours, tokenUsable } from "../bridge/tokens.ts";
import { homeBridgePath } from "../shared/home.ts";
import { versionIn } from "../shared/version.ts";

const out = (s: string): void => {
  process.stdout.write(s + "\n");
};

const hashOf = (buf: Buffer): string => createHash("sha256").update(buf).digest("hex").slice(0, 8);

const seconds = (ms: number): string => `${Math.round(ms / 1000)}s`;

function homeCopyReport(): void {
  const home = homeBridgePath();
  let self: Buffer | null = null;
  try {
    self = readFileSync(fileURLToPath(import.meta.url));
  } catch {}
  if (!existsSync(home)) {
    out(`домашняя копия: нет (${home}) — её кладёт establish-mcp при подключении`);
    return;
  }
  const bytes = readFileSync(home);
  if (self && bytes.equals(self)) {
    out(`домашняя копия: ${home} — та же сборка, что и этот файл`);
    return;
  }
  const v = versionIn(bytes.toString("utf8"));
  out(
    `домашняя копия: ${home} — v${v ?? "?"}+${hashOf(bytes)}, ДРУГИЕ байты: ${
      self
        ? `обнови её из поставки: cp "${fileURLToPath(import.meta.url)}" ${home}`
        : "этот файл не читается"
    }`,
  );
}

async function serverReport(): Promise<void> {
  out(`сервер: ${CFG.serverUrl}`);
  let res: Response;
  try {
    res = await fetch(CFG.serverUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: "doctor", method: "ping" }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    out(`  недостижим: ${errorMessage(e)}`);
    return;
  }
  res.body?.cancel?.();
  const www = res.headers.get("www-authenticate");
  const note = www
    ? " (просит OAuth)"
    : res.status >= 400 && res.status < 500
      ? " (пробник без токена — отказ ожидаем)"
      : "";
  out(`  отвечает: HTTP ${res.status}${note}`);
  try {
    const meta = await discoverMeta(www);
    out(`  OAuth: token endpoint ${meta.as.token_endpoint}`);
    out(`  resource: ${meta.resource}`);
  } catch (e) {
    out(`  OAuth discovery: ${errorMessage(e)}`);
  }
}

async function patReport(): Promise<void> {
  out(`грант: личный токен (PAT) из ${CFG.patSource} — OAuth не используется`);
  let res: Response;
  try {
    res = await fetch(CFG.serverUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${CFG.pat}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "doctor",
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "iskron-doctor", version: "1" },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    out(`  проверить не вышло: ${errorMessage(e)}`);
    return;
  }
  res.body?.cancel?.();
  if (res.status === 401) {
    out(
      "  ТОКЕН ОТВЕРГНУТ (HTTP 401) — отозван, истёк или без прав на этот граф: выпусти новый на странице токенов графа",
    );
  } else if (res.ok) out(`  токен принят сервером (HTTP ${res.status})`);
  else out(`  сервер ответил HTTP ${res.status} — не отказ токена, смотри строку «сервер»`);
  const path = storePath();
  if (existsSync(path)) out(`  хранилище OAuth ${path} есть, но не читается, пока стоит PAT`);
}

function grantReport(): void {
  const path = storePath();
  out(`грант: ${path}`);
  if (!existsSync(path)) {
    out("  хранилища нет — мост ещё ни разу не входил на этот сервер");
    return;
  }
  const store = loadStore();
  const t = store.tokens;
  if (!t?.access_token) {
    out("  токенов нет");
  } else {
    const usable = tokenUsable(t);
    const left = t.expires_at ? t.expires_at - now() : null;
    out(
      `  access: ${usable ? "годен" : "не годен"}${left !== null ? ` (${left > 0 ? "истекает через" : "истёк"} ${seconds(Math.abs(left))})` : ""}`,
    );
    const hours = refreshHours(t);
    if (!t.refresh_token) out("  refresh: нет");
    else {
      const parts: string[] = [];
      if (hours.nbf)
        parts.push(now() < hours.nbf ? `в силе через ${seconds(hours.nbf - now())}` : "в силе");
      if (hours.exp)
        parts.push(
          now() >= hours.exp
            ? "ИСТЁК — нужен вход"
            : `истекает через ${seconds(hours.exp - now())}`,
        );
      out(`  refresh: есть${parts.length ? ` (${parts.join(", ")})` : ""}`);
    }
  }
  if (store.client?.client_id) out(`  client_id: ${store.client.client_id}`);
  const st = loadGrantState();
  if (st.refused_since)
    out(`  отказ стоит с ${new Date(st.refused_since).toISOString()}: ${st.reason ?? ""}`);
  if (st.snooze_until && Date.now() < st.snooze_until) {
    out(`  вход отложен ещё на ${seconds(st.snooze_until - Date.now())} (человек не завершил)`);
  }
  for (const suffix of [".auth-pending", ".refreshing"]) {
    if (existsSync(path + suffix)) out(`  замок: ${path + suffix}`);
  }
  const logPath = grantLogPath();
  if (existsSync(logPath)) {
    const lines = readFileSync(logPath, "utf8").trim().split("\n").slice(-3);
    out(`  grant.log, последнее:`);
    for (const l of lines) out(`    ${l}`);
  }
}

function harnessReport(): void {
  const claude = join(homedir(), ".claude.json");
  if (existsSync(claude)) {
    try {
      const cfg = JSON.parse(readFileSync(claude, "utf8")) as {
        mcpServers?: Record<string, { command?: string; args?: string[] }>;
      };
      const entries = Object.entries(cfg.mcpServers ?? {}).filter(([, v]) =>
        (v.args ?? []).some((a) => /iskron/.test(a)),
      );
      if (entries.length) {
        for (const [name, v] of entries) {
          out(`Claude Code: запись «${name}» → ${v.command ?? ""} ${(v.args ?? []).join(" ")}`);
        }
      } else out("Claude Code: в пользовательском конфиге записи моста нет");
    } catch {
      out(`Claude Code: ${claude} не читается`);
    }
  }
  // OpenCode: плагин из поставки лежит копией в каталоге плагинов; та же сверка, что и у моста.
  const opencodeDir = join(homedir(), ".config", "opencode");
  if (existsSync(opencodeDir)) {
    const copy = join(opencodeDir, "plugins", "iskron.js");
    const packaged = join(dirname(fileURLToPath(import.meta.url)), "opencode-plugin.js");
    if (!existsSync(copy)) {
      out(`OpenCode: плагина нет (${copy}) — его кладёт establish-mcp при подключении`);
    } else if (!existsSync(packaged)) {
      out(
        `OpenCode: плагин ${copy} стоит; рядом с этим файлом поставки плагина нет, сверить не с чем`,
      );
    } else if (readFileSync(copy).equals(readFileSync(packaged))) {
      out(`OpenCode: плагин ${copy} — та же сборка, что в поставке`);
    } else {
      out(`OpenCode: плагин ${copy} — ДРУГИЕ байты, обнови из поставки: cp "${packaged}" ${copy}`);
    }
  }
  const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  const door = join(codexHome, "app-server-control", "app-server-control.sock");
  if (existsSync(codexHome)) {
    if (existsSync(door)) out(`Codex: дверь app-server открыта (${door})`);
    else if (Buffer.byteLength(door) > 100)
      out(
        `Codex: двери нет и не будет — CODEX_HOME длиннее предела unix-сокета (${codexHome}); нужен короткий дом для демона и сессий`,
      );
    else
      out(
        `Codex: двери нет (${door}) — демон app-server не поднят; без неё кадр доставляет watchdog-exit`,
      );
  }
  const codex = join(homedir(), ".codex", "config.toml");
  if (existsSync(codex)) {
    const text = readFileSync(codex, "utf8");
    out(`Codex: ${/iskron/.test(text) ? "запись моста есть" : "записи моста нет"} (${codex})`);
  }
}

export async function runDoctor(argv: string[]): Promise<void> {
  setConfig(parseArgs(argv));
  out(`iskron doctor — ${BUILD}`);
  out(`этот файл: ${fileURLToPath(import.meta.url)}`);
  out(`node: ${process.version}`);
  homeCopyReport();
  await serverReport();
  if (CFG.pat) await patReport();
  else grantReport();
  harnessReport();
}
