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
  /** Строка, которую сервер принял: doing ответа; без него при обрезке — выведенная правилом, иначе нет (легла отправленная). */
  doing?: string;
  /** Строка принята обрезанной (warnings[] trimmed_to_limit). */
  trimmed?: StatusTrim;
}

/**
 * Строка занятости длиннее предела ложится обрезанной по слову, полный текст —
 * в истории места (граф nks-dev: #6729, нудж #6730; дело №234): ответ POST — 200
 * {doing, doing_at, warnings?}, элемент warnings — {code: trimmed_to_limit, message}
 * (дело №234 [139]). doing — принятая строка, message — слово сервера агенту.
 */
export interface StatusTrim {
  doing: string;
  message: string;
}

const TRIMMED = "trimmed_to_limit";
/** Предел строки api 0.108.0 — только для вывода принятой строки, когда ответ её не назвал. */
const LIMIT = 64;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

/**
 * Строка, какой сервер её кладёт, — запасной путь, когда ответ doing не несёт
 * (сервер до api 0.108.0): по слову до max знаков с «…» (дело №234 [22], #6729).
 */
export function trimToWord(text: string, max: number): string {
  const chars = [...text];
  const head = chars.slice(0, max - 1).join("");
  // Знак за головой — пробел: голова кончается словом целиком.
  const cut = chars[max - 1] === " " ? head.length : head.lastIndexOf(" ");
  return (cut > 0 ? head.slice(0, cut) : head).trimEnd() + "…";
}

/**
 * Принятая строка и обрезка из тела удачного ответа. Принятая — doing верхнего
 * уровня; ответ без doing (тело не JSON или сервер до api 0.108.0) — отправленная,
 * а при предупреждении trimmed_to_limit — выведенная правилом: отправленная за
 * принятую не выдаётся и в держание не ложится.
 */
function acceptedIn(body: string, sent: string): Pick<StatusOutcome, "doing" | "trimmed"> {
  let parsed: Obj = {};
  try {
    parsed = obj(JSON.parse(body));
  } catch {
    /* прежний сервер: тело не JSON */
  }
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
  const w = obj(warnings.find((x) => obj(x).code === TRIMMED));
  const told = typeof parsed.doing === "string" ? parsed.doing : null;
  if (!w.code) return told === null ? {} : { doing: told };
  const doing = told ?? trimToWord(sent, LIMIT);
  const message = typeof w.message === "string" ? w.message.trim() : "";
  return { doing, trimmed: { doing, message } };
}

/** Нудж обрезки агенту: слово сервера; без него — что обрезано; ход — переназвать коротко. */
export function trimNudge(t: StatusTrim): string {
  if (t.message)
    return L(`строка обрезана сервером: ${t.message}`, `the server trimmed the line: ${t.message}`);
  return L(
    "сервер обрезал строку; полный текст — в истории места, переназови короче",
    "the server trimmed the line; the full text is in the seat's history, rename it shorter",
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
  return { ok: true, body, ...acceptedIn(body, text) };
}
