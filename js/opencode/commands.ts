// Половина «команды» — скиллы поставки в палитре «/» OpenCode.
//
// Контракт поставки: каждый скилл с `slash: true` во фронтматтере набирается
// человеком как /name. OpenCode 2 этот ключ отбрасывает (парсер берёт name,
// description и metadata.opencode/autoinvoke), а палитру «/» собирает только из
// команд; скилл в ней — лишь «@»-упоминание. Поэтому команду на каждый такой
// скилл регистрирует плагин: она грузит скилл тулом skill и отдаёт агенту слова
// человека как есть. Ключ читается из самого SKILL.md по пути, который OpenCode
// отдаёт в списке скиллов, — так набор команд равен установленному набору
// поставки, а не списку в коде.
import { readFileSync } from "node:fs";

import type { Context } from "./plugin.ts";
import { type Say } from "./tools.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- ответы SDK без схемы */

export interface SkillCommand {
  id: string;
  description: string;
}

export interface CommandsHalf {
  /** Перечитать скиллы и переиграть команды (skill.updated). */
  refresh(): Promise<void>;
}

/** `slash: true` во фронтматтере — и только оно; всё прочее — не команда. */
export function slashOf(markdown: string): boolean {
  if (!markdown.startsWith("---")) return false;
  const end = markdown.indexOf("\n---", 3);
  if (end < 0) return false;
  const head = markdown.slice(3, end);
  return /^slash:\s*true\s*$/m.test(head);
}

/** Текст, который команда кладёт в сессию вместо слова человека. */
export function commandText(id: string, args: string): string {
  return (
    `Загрузи скилл \`${id}\` инструментом \`skill\` (id: \`${id}\`) и действуй строго по нему. ` +
    "Это набрал человек, а не ты; его слова — ниже.\n\n" +
    args.trim()
  );
}

async function listSkills(ctx: Context): Promise<SkillCommand[]> {
  const res: any = await ctx.skill.list();
  const list: any[] = Array.isArray(res) ? res : (res?.data ?? []);
  const out: SkillCommand[] = [];
  for (const s of list) {
    const id = String(s?.id ?? "");
    const path = typeof s?.path === "string" ? s.path : null;
    if (!id || !path) continue;
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    if (!slashOf(text)) continue;
    const description = String(s?.description ?? "")
      .split(/(?<=[.!?])\s|\n/)[0]
      .slice(0, 140);
    out.push({ id, description });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function setupCommands(ctx: Context, say: Say): Promise<CommandsHalf> {
  const state = { commands: await listSkills(ctx) };
  await ctx.command.transform((editor) => {
    for (const { id, description } of state.commands) {
      editor.add({
        name: id,
        description,
        async execute({ sessionID, prompt, delivery }) {
          await ctx.session.prompt({
            ...(prompt as any),
            sessionID,
            text: commandText(id, String((prompt as any)?.text ?? "")),
            delivery,
          } as any);
        },
      });
    }
  });
  if (state.commands.length)
    say(`Искрон: команд «/» по скиллам поставки: ${state.commands.length}.`, "info");
  return {
    async refresh() {
      const next = await listSkills(ctx);
      const same =
        next.length === state.commands.length &&
        next.every((c, i) => c.id === state.commands[i]?.id);
      state.commands = next;
      if (!same) await ctx.command.reload();
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
