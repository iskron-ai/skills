// Свёртка строк ключа в пачке агенту (граф nks-dev: #6718, доля моста в #6715):
// одна функция на все пачки — окно комнаты сторожам, побудку, лежалые, пачки
// плагинов pi и OpenCode и сторожа Codex, — потому что все считают счёт дела
// одной строкой (frame-text.ts caseCountLine).
import { addressedToMine } from "./addressed.ts";
import { type Frame } from "./channel.ts";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const idOf = (v: unknown): string =>
  typeof v === "number" || (typeof v === "string" && v) ? String(v) : "";

/**
 * Строки работы, сменённые в пачке: кадр line.kind progress, за которым в пачке
 * есть строка того же ключа (room.id, line.key) с большим entry_id, — читателю
 * нужна только последняя. Признака «сменяет» в кадре нет: сменяет любая следующая
 * строка ключа. Не сворачиваются и не гасят чужое: всё, что не progress (вход и
 * выход, приглашение, ведущий, слово, закрытие, возражение), адресованное месту
 * и строка с вердиктом bad. Доставленными метятся все кадры, и сменённые.
 */
export function superseded(frames: Frame[]): Set<Frame> {
  const last = new Map<string, { frame: Frame; at: number }>();
  const out = new Set<Frame>();
  frames.forEach((f, i) => {
    const r = f as Rec;
    const line = rec(r.line);
    const key = typeof line.key === "string" ? line.key : "";
    if (line.kind !== "progress" || !key || line.verdict === "bad" || addressedToMine(f)) return;
    const k = `${idOf(rec(r.room).id) || idOf(rec(r.room).seq)}|${key}`;
    const e = Number(r.entry_id ?? line.entry_id);
    const at = Number.isFinite(e) ? e : i;
    const was = last.get(k);
    if (!was) return void last.set(k, { frame: f, at });
    if (at >= was.at) {
      out.add(was.frame);
      last.set(k, { frame: f, at });
    } else out.add(f);
  });
  return out;
}
