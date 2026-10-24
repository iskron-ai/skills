// POSTs to one status address in turn after a fall back from the dispatcher (graph @nks/nks-dev,
// node #8620): the lines held for hello open the turn, a fresh line waits behind them, so an
// older line never lands after a newer one. With no turn open a POST goes at once, as before.
const tails = new Map<string, Promise<unknown>>();

/** `fn` in the turn of `url`; `open` — start one if none is (the held lines). */
export function inTurn<T>(url: string, fn: () => Promise<T>, open = false): Promise<T> {
  const prev = tails.get(url) ?? (open ? Promise.resolve() : null);
  if (!prev) return fn();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => {});
  tails.set(url, tail);
  void tail.then(() => {
    if (tails.get(url) === tail) tails.delete(url);
  });
  return next;
}
