// Пробный запуск моста-спутника для раздела «субагенты» doctor: та команда,
// которую поднимет харнес, отвечает ли на initialize и tools/list, и примет
// ли API Anthropic схемы её тулов. Схема с oneOf/allOf/anyOf на верхнем уровне
// роняет весь прогон субагента ошибкой 400, не назвав тула, — здесь он назван.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { CLIENTS, envName } from "../delivery/index.ts";
import { L } from "../shared/lang.ts";

const PROBE_MS = Number(process.env[envName("DOCTOR_PROBE_MS")]) || 30_000;
/** Срок одного запроса пробного моста: столько он может ждать запрос в полёте, уходя. */
const REQUEST_MS = 20_000;
/** Windows: ожидание ухода по закрытому stdin — дольше срока запроса со сменой токена. */
const WIN_WAIT_MS = 40_000;

interface Reply {
  id?: unknown;
  error?: { message?: unknown };
  result?: {
    serverInfo?: { name?: string; version?: string };
    tools?: { name?: string; inputSchema?: Record<string, unknown> }[];
  };
}

export interface ProbeCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** Как войти, когда у машины нет живого входа: ссылка пробного моста умирает вместе с ним. */
export const loginAdvice = (): string =>
  L(
    "войди: вызови любой тул iskron_* в основной сессии и открой ссылку входа из его ответа (или положи личный токен в ~/.iskron-bridge/token — скилл establish-mcp), потом повтори doctor",
    "log in: call any iskron_* tool in the main session and open the login link from its answer (or put a personal token in ~/.iskron-bridge/token — the establish-mcp skill), then repeat doctor",
  );

/** Отказ, за которым стоит вход: ссылка входа, OAuth, отвергнутый токен. */
const LOGIN_RE = /\/login\b|oauth|authoriz|sign.?in|log.?in|вход|войд|токен отвергнут|\b401\b/i;

/** Итог пробы: `lines` — что наблюдено, `findings` — поломки, у каждой готовое действие. */
export interface ProbeResult {
  lines: string[];
  findings: string[];
}

export async function probeSatellite(
  label: string,
  e: ProbeCommand,
  cwd: string,
): Promise<ProbeResult> {
  const lines: string[] = [];
  const findings: string[] = [];
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...e.env,
    [envName("BRIDGE_NO_BROWSER")]: "1",
    [envName("BRIDGE_NO_UPDATE")]: "1",
    [envName("BRIDGE_ORPHAN_FLOW_MS")]: "1",
    [envName("BRIDGE_TIMEOUT")]: e.env[envName("BRIDGE_TIMEOUT")] ?? String(REQUEST_MS),
  };
  delete env[envName("CHANNEL_SOCKET")]; // проба не держит чужого сокета
  delete env[envName("CHANNEL_STATUS")];
  const child = spawn(e.command, e.args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.on("error", () => {}); // мост ушёл раньше записи — это его исход, не падение doctor
  let stderr = "";
  child.stderr.on("data", (c: Buffer) => (stderr = (stderr + c.toString()).slice(-4000)));
  const replies = new Map<number, Reply>();
  let wake: (() => void) | null = null;
  createInterface({ input: child.stdout }).on("line", (l) => {
    try {
      const m = JSON.parse(l) as Reply;
      if (typeof m.id === "number") replies.set(m.id, m);
    } catch {}
    wake?.();
  });
  let exited: string | null = null;
  child.on("error", (err) => {
    exited = err.message;
    wake?.();
  });
  child.on("exit", (code, sig) => {
    exited ??= L(`вышел с кодом ${code ?? sig}`, `exited with code ${code ?? sig}`);
    wake?.();
  });
  const deadline = Date.now() + PROBE_MS;
  const ask = async (id: number, method: string, params: unknown): Promise<Reply | null> => {
    if (!exited)
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n", () => {});
    while (!replies.has(id) && !exited && Date.now() < deadline)
      await new Promise<void>((res) => {
        wake = res;
        setTimeout(res, 200);
      });
    return replies.get(id) ?? null;
  };
  const tail = () =>
    stderr
      .trim()
      .split("\n")
      .slice(-2)
      .map((s) => s.slice(0, 300))
      .join(" | ");
  const init = await ask(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: CLIENTS.doctor, version: "1" },
  });
  // Отказ со ссылкой входа — мёртвый грант машины: ссылку проба унесёт с собой,
  // поэтому совет тот же, что без входа, а не «сделай, что велит отказ».
  const refusal = (what: string, raw: unknown): string => {
    const msg = String(raw ?? "");
    return LOGIN_RE.test(msg)
      ? L(
          `проба «${label}»: ${what} — спутник не вошёл: грант машины мёртв или отозван → ${loginAdvice()}`,
          `probe "${label}": ${what} — the satellite is not logged in: the machine grant is dead or revoked → ${loginAdvice()}`,
        )
      : L(
          `проба «${label}»: ${what} вернул отказ: ${msg.slice(0, 300)} → сделай, что велит отказ, и повтори doctor`,
          `probe "${label}": ${what} returned a refusal: ${msg.slice(0, 300)} → do what the refusal says and repeat doctor`,
        );
  };
  if (!init) {
    const why =
      exited ??
      L(`молчит ${Math.round(PROBE_MS / 1000)}s`, `silent for ${Math.round(PROBE_MS / 1000)}s`);
    const flag = /unknown argument: --tools/.test(stderr)
      ? "--tools"
      : /satellite|unknown (flag|option)|неизвестн/i.test(stderr)
        ? "--satellite"
        : null;
    const old = flag
      ? L(
          ` — похоже, домашний мост старше флага ${flag} → node ~/.iskron-bridge/iskron-bridge.mjs update`,
          ` — it seems the home bridge is older than the ${flag} flag → node ~/.iskron-bridge/iskron-bridge.mjs update`,
        )
      : L(
          " → запусти эту команду руками и прочти, что она пишет в stderr",
          " → run this command by hand and read what it writes to stderr",
        );
    const stderrNote = tail() ? `; stderr: ${tail()}` : "";
    findings.push(
      L(
        `проба «${label}»: мост не ответил на initialize (${why}${stderrNote})${old}`,
        `probe "${label}": the bridge did not answer initialize (${why}${stderrNote})${old}`,
      ),
    );
  } else if (init.error) {
    findings.push(refusal("initialize", init.error.message));
  } else {
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
      () => {},
    );
    const info = init.result?.serverInfo ?? {};
    const list = await ask(2, "tools/list", {});
    const tools = list?.result?.tools ?? [];
    if (!list)
      findings.push(
        L(
          `проба «${label}»: initialize ответил (${info.name ?? "?"} v${info.version ?? "?"}), tools/list — нет (${exited ?? "молчит"}) → запусти команду руками и прочти её stderr`,
          `probe "${label}": initialize answered (${info.name ?? "?"} v${info.version ?? "?"}), tools/list did not (${exited ?? "silent"}) → run the command by hand and read its stderr`,
        ),
      );
    else if (list.error) findings.push(refusal("tools/list", list.error.message));
    else {
      lines.push(
        L(
          `проба «${label}»: мост ответил — ${info.name ?? "?"} v${info.version ?? "?"}, тулов ${tools.length}`,
          `probe "${label}": the bridge answered — ${info.name ?? "?"} v${info.version ?? "?"}, tools ${tools.length}`,
        ),
      );
      for (const t of tools) {
        const bad = ["oneOf", "allOf", "anyOf"].filter((k) => t.inputSchema && k in t.inputSchema);
        if (bad.length)
          findings.push(
            L(
              `тул ${t.name}: схема несёт ${bad.join(", ")} на верхнем уровне — сервер отдаёт схему, которую API Anthropic отвергнет («input_schema does not support oneOf, allOf, or anyOf at the top level»), и падает весь прогон субагента, не один этот тул → чинит это сервер, не файл агента и не мост (мост отдаёт схему как есть): скажи имя тула оператору сервера MCP — тому, кто держит адрес из строки «сервер» выше, — и жди его обновления, затем повтори doctor`,
              `tool ${t.name}: the schema carries ${bad.join(", ")} at the top level — the server hands out a schema the Anthropic API will reject ("input_schema does not support oneOf, allOf, or anyOf at the top level"), and the whole subagent run fails, not just this tool → the server fixes this, not the agent file or the bridge (the bridge passes the schema as is): tell the MCP server operator the tool name — whoever holds the address from the "server" line above — and wait for their update, then repeat doctor`,
            ),
          );
      }
    }
  }
  // Уход — вежливо: закрытый stdin и SIGTERM мост отрабатывает сам и перед выходом
  // дожидается запросов в полёте, в том числе смены токена, — SIGKILL посреди неё
  // оставил бы машину со списанным refresh-токеном. Поэтому SIGKILL — только мосту,
  // который не ушёл и после SIGTERM за срок своего запроса, и об этом строка.
  const gone = new Promise<void>((res) => (exited ? res() : child.once("exit", () => res())));
  // Таймеры отпущены: мост, ушедший сразу, не держит doctor лишние секунды.
  const within = (ms: number) =>
    Promise.race([
      gone.then(() => true),
      new Promise<boolean>((res) => setTimeout(() => res(false), ms).unref()),
    ]);
  child.stdin.end();
  if (process.platform === "win32") {
    // На Windows любой сигнал — TerminateProcess, мгновенный и без уборки: мосту
    // остаётся только закрытый stdin, и ждём его дольше смены токена.
    if (!(await within(WIN_WAIT_MS))) {
      child.kill();
      findings.push(
        L(
          `проба «${label}»: мост не ушёл по закрытому stdin за ${WIN_WAIT_MS / 1000}s — снят принудительно → повтори doctor; если он менял токен, вход может понадобиться заново`,
          `probe "${label}": the bridge did not leave on closed stdin within ${WIN_WAIT_MS / 1000}s — killed forcibly → repeat doctor; if it was renewing the token, a login may be needed again`,
        ),
      );
    }
    return { lines, findings };
  }
  if (!(await within(10_000))) {
    child.kill("SIGTERM");
    if (!(await within(REQUEST_MS + 10_000))) {
      child.kill("SIGKILL");
      const secs = Math.round((REQUEST_MS + 20_000) / 1000);
      findings.push(
        L(
          `проба «${label}»: мост не ушёл ни по закрытому stdin, ни по SIGTERM за ${secs}s — снят SIGKILL → повтори doctor; если он менял токен, вход может понадобиться заново`,
          `probe "${label}": the bridge left neither on closed stdin nor on SIGTERM within ${secs}s — killed with SIGKILL → repeat doctor; if it was renewing the token, a login may be needed again`,
        ),
      );
    }
  }
  return { lines, findings };
}
