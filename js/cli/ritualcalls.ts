// Вызовы тулов, которыми прогон области (cli/ritualprobe.ts) испытывает хуки
// плагина ритуалов: запись в путь проектной памяти (memory-guard) и пуш с мержем
// (напоминания после). Вход хука — по типам @opencode/plugin 2.0.4: sessionID без каталога.
import { homedir } from "node:os";
import { join } from "node:path";

export type Fn = (...a: unknown[]) => unknown;
export type Who = "mine" | "theirs";

const memoryPath = join(homedir(), ".claude", "projects", "-probe", "memory", "MEMORY.md");
const pushed = "To github.com:o/r.git\n   1234567..89abcde  feat/x -> feat/x";

const calls = (sessionID: Who) => ({
  before: ["write", "edit"].map((tool) => ({
    tool,
    sessionID,
    agent: "build",
    messageID: "msg",
    id: `call-${tool}`,
    input: { filePath: memoryPath, content: "x" },
  })),
  after: [
    ["git push -u origin feat/x", pushed],
    ["gh pr merge 12 --squash --delete-branch", ""],
  ].map(([command, content]) => ({
    tool: "bash",
    sessionID,
    agent: "build",
    messageID: "msg",
    id: "call-bash",
    status: "completed",
    input: { command },
    result: { content, metadata: { exit: 0 } },
  })),
});

/** Зовёт хуки тулов на вызовах сессии; возвращает, какие из них бросили или подменили вызов. */
export async function runHooks(hooks: Record<string, Fn[]>, who: Who): Promise<string[]> {
  const hit: string[] = [];
  const c = calls(who);
  for (const [name, inputs] of [
    ["execute.before", c.before],
    ["execute.after", c.after],
  ] as const) {
    for (const input of inputs) {
      const was = JSON.stringify(input);
      for (const fn of hooks[name] ?? []) {
        try {
          await fn(input);
        } catch (e) {
          hit.push(`${name} ${input.tool}: throw (${String((e as Error)?.message ?? e)})`);
        }
      }
      if (JSON.stringify(input) !== was) hit.push(`${name} ${input.tool}: changed`);
    }
  }
  return hit;
}
