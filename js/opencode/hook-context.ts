// One-shot words belong to an admitted user id, not to its text or the next request
// (graph @nks/nks-dev, nodes #9341, #9867). Compaction never consumes this buffer.
export function createHookContext(closed: (session: string) => boolean) {
  const pending = new Map<string, Map<string, string[]>>();
  const riding = new Map<string, Set<string>>();
  const generations = new Map<string, number>();
  const forgotten = new Set<string>();
  let stopped = false;
  const clear = (s: string): void => {
    pending.delete(s);
    riding.delete(s);
  };
  const allowed = (s: string): boolean => !stopped && !forgotten.has(s) && !closed(s);

  return {
    prepare(s: string, message: string) {
      const generation = generations.get(s);
      const current = (): boolean => allowed(s) && generations.get(s) === generation;
      return {
        put(text: string | null | undefined): void {
          if (!text || !current()) return;
          const byMessage = pending.get(s) ?? new Map<string, string[]>();
          byMessage.set(message, [...(byMessage.get(message) ?? []), text]);
          pending.set(s, byMessage);
        },
        ride(): void {
          if (!current()) return;
          const ids = riding.get(s) ?? new Set<string>();
          ids.add(message);
          riding.set(s, ids);
        },
      };
    },
    take(s: string, messages: readonly { role: unknown; id?: unknown }[]) {
      const result = { words: [] as string[], ride: false };
      if (!allowed(s)) {
        clear(s);
        return result;
      }
      const ids = new Set(
        messages.flatMap((m) => (m.role === "user" && typeof m.id === "string" ? [m.id] : [])),
      );
      const queued = pending.get(s);
      const riders = riding.get(s);
      for (const id of ids) {
        result.words.push(...(queued?.get(id) ?? []));
        queued?.delete(id);
        if (riders?.delete(id)) result.ride = true;
      }
      if (!queued?.size) pending.delete(s);
      if (!riders?.size) riding.delete(s);
      return result;
    },
    forget(s: string): void {
      forgotten.add(s);
      clear(s);
      generations.delete(s);
    },
    moved(s: string): void {
      clear(s);
      generations.set(s, (generations.get(s) ?? 0) + 1);
    },
    stop(): void {
      stopped = true;
      pending.clear();
      riding.clear();
    },
  };
}
