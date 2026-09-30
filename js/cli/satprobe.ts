// Пробный запуск моста-спутника для раздела «субагенты» doctor: та команда,
// которую поднимет харнес, отвечает ли на initialize и tools/list, и примет
// ли API Anthropic схемы её тулов. Схема с oneOf/allOf/anyOf на верхнем уровне
// роняет весь прогон субагента ошибкой 400, не назвав тула, — здесь он назван.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const PROBE_MS = Number(process.env.ISKRON_DOCTOR_PROBE_MS) || 30_000;

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

/** Строки отчёта пробы; первая — ответил ли мост, дальше — тулы, чьи схемы API отвергнет. */
export async function probeSatellite(
  label: string,
  e: ProbeCommand,
  cwd: string,
): Promise<string[]> {
  const lines: string[] = [];
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...e.env,
    ISKRON_BRIDGE_NO_BROWSER: "1",
    ISKRON_BRIDGE_NO_UPDATE: "1",
    ISKRON_BRIDGE_ORPHAN_FLOW_MS: "1",
  };
  delete env.ISKRON_CHANNEL_SOCKET; // проба не держит чужого сокета
  delete env.ISKRON_CHANNEL_STATUS;
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
    exited ??= `вышел с кодом ${code ?? sig}`;
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
    clientInfo: { name: "iskron-doctor", version: "1" },
  });
  if (!init) {
    const why = exited ?? `молчит ${Math.round(PROBE_MS / 1000)}s`;
    const old = /satellite|unknown (flag|option)|неизвестн/i.test(stderr)
      ? " — похоже, домашний мост старше флага --satellite → node ~/.iskron-bridge/iskron-bridge.mjs update"
      : " → запусти эту команду руками и прочти, что она пишет в stderr";
    lines.push(
      `проба «${label}»: мост не ответил на initialize (${why}${tail() ? `; stderr: ${tail()}` : ""})${old}`,
    );
  } else if (init.error) {
    lines.push(
      `проба «${label}»: initialize вернул отказ: ${String(init.error.message ?? "").slice(0, 300)} → сделай, что велит отказ; вход в граф общий для машины — войди мостом основной сессии, и спутник возьмёт тот же грант`,
    );
  } else {
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
      () => {},
    );
    const info = init.result?.serverInfo ?? {};
    const list = await ask(2, "tools/list", {});
    const tools = list?.result?.tools ?? [];
    if (!list)
      lines.push(
        `проба «${label}»: initialize ответил (${info.name ?? "?"} v${info.version ?? "?"}), tools/list — нет (${exited ?? "молчит"}) → запусти команду руками`,
      );
    else if (list.error)
      lines.push(
        `проба «${label}»: tools/list вернул отказ: ${String(list.error.message ?? "").slice(0, 300)} → сделай, что велит отказ`,
      );
    else {
      lines.push(
        `проба «${label}»: мост ответил — ${info.name ?? "?"} v${info.version ?? "?"}, тулов ${tools.length}`,
      );
      for (const t of tools) {
        const bad = ["oneOf", "allOf", "anyOf"].filter((k) => t.inputSchema && k in t.inputSchema);
        if (bad.length)
          lines.push(
            `  тул ${t.name}: схема несёт ${bad.join(", ")} на верхнем уровне — сервер отдаёт схему, которую API Anthropic отвергнет («input_schema does not support oneOf, allOf, or anyOf at the top level»), и падает весь прогон субагента, не один этот тул → чинит это сервер, не файл агента и не мост (мост отдаёт схему как есть): скажи владельцу графа имя тула и жди обновления сервера, затем повтори doctor`,
          );
      }
    }
  }
  child.stdin.end();
  const gone = new Promise<void>((res) => (exited ? res() : child.once("exit", () => res())));
  // Таймер отпущен: иначе doctor ждал бы его, и мост, ушедший сразу, стоил бы пять секунд.
  await Promise.race([gone, new Promise((res) => setTimeout(res, 5000).unref())]);
  if (!exited) child.kill("SIGKILL");
  return lines;
}
