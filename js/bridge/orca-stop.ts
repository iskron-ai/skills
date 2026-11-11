// Observed Orca 1.4.242 post-close surface (#9966, #9256; case 4542): terminal show
// remains readable, and wait --for exit reports the outcome. CLI close exit0 alone is not it.
import { ORCA_VERSION, run } from "./orchestra-orca.ts";

interface Reply {
  ok?: boolean;
  _meta?: { runtimeId?: string };
  result?: {
    terminal?: { handle?: string; incarnationId?: string; connected?: boolean; writable?: boolean };
    close?: { handle?: string; ptyKilled?: boolean };
    wait?: { handle?: string; condition?: string; satisfied?: boolean; status?: string };
  };
}
const parse = (out: string): Reply => {
  try {
    return JSON.parse(out) as Reply;
  } catch {
    return {};
  }
};

export async function orcaCloseObserved(
  handle: string,
  runtime: string,
  current: () => boolean,
): Promise<string | null> {
  const version = await run(["--version"], 5_000);
  if (version.code !== 0 || version.out.trim() !== ORCA_VERSION) return "orca_version_unverified";
  const show = async (): Promise<Reply> => {
    const r = await run(["terminal", "show", "--terminal", handle, "--json"], 5_000);
    return r.code === 0 ? parse(r.out) : {};
  };
  const before = await show();
  const t = before.result?.terminal;
  if (!before.ok || before._meta?.runtimeId !== runtime || t?.handle !== handle || !t.incarnationId)
    return "terminal_binding_unconfirmed";
  if (!current()) return "stop_superseded";
  const close = await run(["terminal", "close", "--terminal", handle, "--json"], 5_000);
  const closed = parse(close.out);
  if (
    close.code !== 0 ||
    !closed.ok ||
    closed._meta?.runtimeId !== runtime ||
    closed.result?.close?.handle !== handle ||
    closed.result.close.ptyKilled !== true
  )
    return "terminal_close_unconfirmed";
  const waited = await run(
    ["terminal", "wait", "--terminal", handle, "--for", "exit", "--timeout-ms", "5000", "--json"],
    7_000,
  );
  const observed = parse(waited.out),
    w = observed.result?.wait;
  if (
    waited.code !== 0 ||
    !observed.ok ||
    observed._meta?.runtimeId !== runtime ||
    w?.handle !== handle ||
    w.condition !== "exit" ||
    w.satisfied !== true ||
    w.status !== "exited"
  )
    return "client_exit_unconfirmed";
  const after = await show(),
    a = after.result?.terminal;
  if (
    !after.ok ||
    after._meta?.runtimeId !== runtime ||
    a?.handle !== handle ||
    a.incarnationId !== t.incarnationId ||
    a.connected !== false ||
    a.writable !== false
  )
    return "terminal_exit_unconfirmed";
  return current() ? null : "stop_superseded";
}
