// One next-turn message after the session store's publish cycle (graph @nks/nks-dev, node #10776):
// a synchronous followup from inside a session event is rejected ("cannot reenter while another
// append is being published" — observed live on compaction/end, case 5251 stage 2), so the word
// goes on the next macrotask and retries a reentry a few times.
import { type DshAgent } from "./hearing.ts";

/** Lands when the followup is taken; rejects on its error or when signal aborted first. */
export function afterPublish(
  a: DshAgent,
  message: unknown,
  signal?: AbortSignal,
  tries = 5,
): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(
      () => {
        if (signal?.aborted) return reject(new Error("aborted"));
        try {
          Promise.resolve(a.followup(message)).then(() => resolve(), reject);
        } catch (e) {
          if (tries > 0 && (e as Error).message.includes("reenter"))
            return void afterPublish(a, message, signal, tries - 1).then(resolve, reject);
          reject(e as Error);
        }
      },
      tries === 5 ? 0 : 25,
    );
  });
}
