// POST строки занятости на названный статусный адрес — лист без зависимостей от
// держания: его зовут и status.ts, и handoff.ts (занятость места, которое преемник
// не взял), а hold.ts → handoff.ts → status.ts → hold.ts замкнулось бы в цикл.

/** Исход POST занятости; code — HTTP-код отказа поверхности, когда он был. */
export interface StatusOutcome {
  ok: boolean;
  body: string;
  code?: number;
}

// Соединение закрыто под запросом, ответа не было: Node (undici) — UND_ERR_SOCKET
// «other side closed», Bun — ECONNRESET «The socket connection was closed unexpectedly».
const CLOSED = new Set(["UND_ERR_SOCKET", "ECONNRESET", "EPIPE"]);
const closedUnder = (e: unknown): boolean => {
  const err = e as { code?: string; cause?: { code?: string } };
  return CLOSED.has(err?.code ?? "") || CLOSED.has(err?.cause?.code ?? "");
};

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
      body: `Отказано (мост): статусный адрес не ответил — ${(e as Error).message}`,
    };
  }
  const body = (await res.text().catch(() => "")).trim();
  if (res.status === 404)
    return {
      ok: false,
      code: 404,
      body: `Отказано (404) поверхностью: ${body || "без тела"} — этот адрес места больше не адресует: его мог повернуть connect другого держателя, а мог держать другой экземпляр моста той же сессии. Чей он теперь, мост отсюда не знает.`,
    };
  if (!res.ok)
    return {
      ok: false,
      code: res.status,
      body: `Отказано (${res.status}) поверхностью: ${body || "без тела"}`,
    };
  return { ok: true, body };
}
