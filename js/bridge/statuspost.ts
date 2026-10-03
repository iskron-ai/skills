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
  return { ok: true, body };
}
