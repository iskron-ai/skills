// Родное уведомление OpenCode о субагенте (граф nks-dev: #6625) — синтетика
// `<subagent sessionID="…" state="completed">` в родителя на конце ХОДА ребёнка,
// а у задачи без фона — тот же текст результатом тула. Плагин его не перехватывает
// (уведомление пишет ядро, не хук), но до чтения моделью доходит хук "context"
// (SessionContext типов @opencode/plugin 2.0.x: system и messages — изменяемые):
// на живого ведущего субагента, названного таким уведомлением, плагин кладёт в
// system слово, что это ход, не поручение. Кончился — слова нет: итог уже лёг.
/* eslint-disable @typescript-eslint/no-explicit-any -- части сообщений без схемы */
import { noticeWord } from "./leadwords.ts";

const COMPLETED = /<subagent sessionID=\\?"([^"\\]+)\\?" state=\\?"completed\\?"/g;

/** Тексты частей сообщения, где может стоять уведомление: текст и результат тула. */
function* texts(messages: readonly any[]): Generator<string> {
  for (const m of messages)
    for (const part of Array.isArray(m?.content) ? m.content : []) {
      if (part?.type === "text" && typeof part.text === "string") yield part.text;
      else if (part?.type === "tool-result") yield JSON.stringify(part.result ?? "");
    }
}

/** Слово в system запроса на каждого живого ведущего, чей ход OpenCode назвал «completed». */
export function annotate(
  req: { system: any[]; messages: readonly any[] },
  nameOf: (child: string) => string | null,
): void {
  const seen = new Set<string>();
  for (const text of texts(req.messages ?? []))
    for (const [, child] of text.matchAll(COMPLETED)) {
      if (!child || seen.has(child)) continue;
      seen.add(child);
      const name = nameOf(child);
      if (name) req.system.push({ type: "text", text: noticeWord(child, name) });
    }
}

/* eslint-enable @typescript-eslint/no-explicit-any */
