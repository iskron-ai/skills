// Вызовы тулов, которыми прогон области (cli/ritualprobe.ts) испытывает хуки
// плагина ритуалов: запись в путь проектной памяти (memory-guard), обычная запись
// (guard молчит) и пуш с мержем (напоминания после). Вход хука — по типам @opencode/plugin 2.0.4: sessionID без каталога.
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
  plain: [
    {
      tool: "write",
      sessionID,
      agent: "build",
      messageID: "msg",
      id: "call-plain",
      input: { filePath: "README.md", content: "x" },
    },
  ],
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

// Ошибка самого кода хука, не блокировка: образец исполняется как есть, и
// неопределённое имя — провал, а не guard.
const BROKEN = new Set(["ReferenceError", "TypeError", "SyntaxError", "RangeError"]);

export interface Hits {
  /** Бросок или подмена вызова: «execute.before write: throw (…)», «execute.after bash: changed». */
  hit: string[];
  /** Хук сломан: бросок ошибки кода, бросок на обычной записи или после вызова. */
  broken: string[];
}

/** Зовёт хуки тулов на вызовах сессии; что бросило, подменило вызов или сломалось. */
export async function runHooks(hooks: Record<string, Fn[]>, who: Who): Promise<Hits> {
  const hit: string[] = [];
  const broken: string[] = [];
  const c = calls(who);
  for (const [name, inputs] of [
    ["execute.before", c.before],
    ["execute.before", c.plain],
    ["execute.after", c.after],
  ] as const) {
    for (const input of inputs) {
      const was = JSON.stringify(input);
      const what = `${name} ${input.tool}${input.id === "call-plain" ? " (не путь памяти)" : ""}`;
      for (const fn of hooks[name] ?? []) {
        try {
          await fn(input);
        } catch (e) {
          const err = e as Error;
          const said = `${what}: throw (${err?.name ?? "?"}: ${String(err?.message ?? e)})`;
          hit.push(said);
          if (BROKEN.has(err?.name) || input.id === "call-plain" || name === "execute.after")
            broken.push(said);
        }
      }
      if (JSON.stringify(input) !== was) hit.push(`${what}: changed`);
    }
  }
  return { hit, broken };
}
