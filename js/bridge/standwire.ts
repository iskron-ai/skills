// Ходы моста, которые встают тем же iskron_stand, что агент (stand.ts), — переданы
// туда, где они нужны, отсюда: прямой импорт stand.ts замкнул бы круг импортов.
//   • место отняли (evicted.ts, #6706) — встать рядом на имя.N;
//   • возврат места, чей сокет держит прежний мост этой же сессии (resume.ts, #6702), —
//     взять его тем же суждением, что iskron_stand, без take.
import { ID_PREFIX, tool } from "../delivery/index.ts";
import { serialized } from "./call.ts";
import { wireEviction } from "./evicted.ts";
import { wireTakeOwn } from "./resume.ts";
import { baseOf } from "./separate.ts";
import { isDirectory, runStand } from "./stand.ts";

/** iskron_stand по имени места изнутри моста, без take: ответ — исход и текст. */
async function standAs(
  id: string,
  place: { realm: string; karta: string | number; name: string },
  cwd: string | null | undefined,
): Promise<{ ok: boolean; text: string }> {
  const { realm, karta, name } = place;
  const where = cwd && isDirectory(cwd) ? { cwd } : {};
  const r = await runStand({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: tool("stand"), arguments: { realm, karta: String(karta), name, ...where } },
  });
  const text = ((r.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "");
  return { ok: !r.result?.isError, text: text.join("\n") };
}

wireEviction((place, cwd) =>
  serialized(() =>
    standAs(
      `${ID_PREFIX}bridge-evicted`,
      { ...place, name: baseOf(place.realm, place.karta, place.name ?? "") }, // основа, от которой место выбрано (#6706)
      cwd,
    ),
  ),
);

// Возврат уже идёт под serialized (deliver.ts): второй serialized ждал бы сам себя.
wireTakeOwn(
  async (rec, cwd) => (await standAs(`${ID_PREFIX}bridge-resume`, rec, cwd)).text.split("\n")[0],
);
