// POST строки занятости на названный статусный адрес — лист без зависимостей от
// держания: его зовут и status.ts, и handoff.ts (занятость места, которое преемник
// не взял), а hold.ts → handoff.ts → status.ts → hold.ts замкнулось бы в цикл.
import { L } from "../shared/lang.ts";
import { closedUnder } from "./errors.ts";

/** Исход POST занятости; code — HTTP-код отказа поверхности, когда он был. */
export interface StatusOutcome {
  ok: boolean;
  body: string;
  code?: number;
  /** Строка принята обрезанной (warnings[] trimmed_to_limit). */
  trimmed?: StatusTrim;
}

/**
 * Строка занятости длиннее предела ложится обрезанной по слову, полный текст —
 * в истории места (граф nks-dev: #6729, нудж #6730; дело №234): ответ POST — 200
 * с warnings[] кода trimmed_to_limit, кадр сокета — {type: "status_trimmed", code,
 * doing, max, message}. doing — принятая строка, null — сервер её не назвал.
 */
export interface StatusTrim {
  doing: string | null;
  max: number | null;
  message: string;
}

export const TRIMMED = "trimmed_to_limit";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

/** Обрезка из предупреждения ответа или кадра сокета; поля ищутся и в data, и на верхнем уровне ответа. */
export function trimOf(w: unknown, top: unknown = {}): StatusTrim {
  const [a, b, c] = [obj(w), obj(obj(w).data), obj(top)];
  const pick = (k: string): unknown => a[k] ?? b[k] ?? c[k];
  const doing = pick("doing");
  const max = Number(pick("max") ?? pick("limit"));
  const message = pick("message");
  return {
    doing: typeof doing === "string" ? doing : null,
    max: Number.isFinite(max) && max > 0 ? max : null,
    message: typeof message === "string" ? message.trim() : "",
  };
}

/** warnings[] кода trimmed_to_limit в теле удачного ответа; иначе undefined (тело не JSON — прежний сервер). */
function trimmedIn(body: string): StatusTrim | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  const warnings = obj(parsed).warnings;
  const w = Array.isArray(warnings) ? warnings.find((x) => obj(x).code === TRIMMED) : undefined;
  return w ? trimOf(w, parsed) : undefined;
}

/** Нудж обрезки агенту: до скольких обрезано, слово сервера; ход — переназвать коротко. */
export function trimNudge(t: StatusTrim): string {
  if (t.message)
    return L(`строка обрезана сервером: ${t.message}`, `the server trimmed the line: ${t.message}`);
  const max = t.max ?? 64;
  return L(
    `сервер обрезал строку до ${max} знаков; полный текст — в истории места, переназови короче`,
    `the server trimmed the line to ${max} characters; the full text is in the seat's history, rename it shorter`,
  );
}

/** Тот же POST на названный адрес — для выхода, когда стояние уже отпущено, а адрес снят до этого. */
export async function publishStatusTo(
  url: string,
  text: string,
  timeoutMs = 5000,
  standingId: string | null = null,
): Promise<StatusOutcome> {
  const signal = AbortSignal.timeout(timeoutMs);
  const post = (): Promise<Response> =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(standingId ? { text, standing_id: standingId } : { text }),
      signal,
    });
  let res: Response;
  try {
    // Строка занятости ставится, а не копится, — повтор безвреден. Один и только на
    // закрытом соединении (keep-alive из пула, закрытый сервером): ответ поверхности не повторяется.
    res = await post().catch((e: unknown) => {
      if (!closedUnder(e) || signal.aborted) throw e;
      return post();
    });
  } catch (e) {
    return {
      ok: false,
      body: L(
        `Отказано (мост): статусный адрес не ответил — ${(e as Error).message}`,
        `Refused (bridge): the status address did not answer — ${(e as Error).message}`,
      ),
    };
  }
  const body = (await res.text().catch(() => "")).trim();
  if (res.status === 404)
    return {
      ok: false,
      code: 404,
      body: L(
        `Отказано (404) поверхностью: ${body || "без тела"} — этот адрес места больше не адресует: его мог повернуть connect другого держателя, а мог держать другой экземпляр моста той же сессии. Чей он теперь, мост отсюда не знает.`,
        `Refused (404) by the surface: ${body || "no body"} — this seat address no longer addresses: another holder's connect may have turned it, or another instance of the same session's bridge may have held it. Whose it is now, the bridge cannot know from here.`,
      ),
    };
  if (!res.ok)
    return {
      ok: false,
      code: res.status,
      body: L(
        `Отказано (${res.status}) поверхностью: ${body || "без тела"}`,
        `Refused (${res.status}) by the surface: ${body || "no body"}`,
      ),
    };
  const trimmed = trimmedIn(body);
  return { ok: true, body, ...(trimmed ? { trimmed } : {}) };
}
