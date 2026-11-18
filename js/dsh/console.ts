// The plugin's two doors to its dsh context (graph @nks/nks-dev, node #10776): its loud line and
// its listeners. Headless dsh does not print ctx.logger at all (observed live, #10905): a loud
// line goes to the process's stderr too, where a person running headless sees it; a listener the
// context refuses is said, not thrown.
/* eslint-disable @typescript-eslint/no-explicit-any -- dsh SDK events without a schema */

export interface DshCtx {
  on(event: string, fn: (...args: any[]) => unknown): unknown;
  logger?: { info?: (...args: unknown[]) => void };
}

export function loudOf(ctx: DshCtx): (text: string) => void {
  return (text) => {
    try {
      ctx.logger?.info?.(text);
    } catch {
      /* the console is not ours */
    }
    console.error(text);
  };
}

export function listenerOf(
  ctx: DshCtx,
  refused: (why: string) => void,
): (event: string, fn: (...args: any[]) => unknown) => void {
  return (event, fn) => {
    try {
      ctx.on(event, fn);
    } catch (e) {
      refused(`${event}: ${(e as Error).message}`);
    }
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
