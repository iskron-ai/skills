// Read-only account evidence for the first prompt. Unknown never invites.
import { tool } from "../delivery/index.ts";
import { completeRealmList } from "./realm-list.ts";

type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as ObjectValue) : null;
const textOf = (v: ObjectValue): string =>
  Array.isArray(v.content) ? v.content.map((c) => object(c)?.text ?? "").join("\n") : "";

/** Fields win over prose. JSON prose also supports MCPs without structuredContent. */
function payload(v: ObjectValue): unknown {
  if ("structuredContent" in v) return v.structuredContent;
  try {
    return JSON.parse(textOf(v));
  } catch {
    return null;
  }
}

/** Only a complete, recognisable list is evidence of absence. */
function emptyList(v: ObjectValue): boolean | null {
  // No observed structured realm-list schema exists in the bridge's fixtures/readers.
  if ("structuredContent" in v) return null;
  const refs = completeRealmList(textOf(v));
  return refs === null ? null : refs.every((r) => r.endsWith("/mind"));
}

export type OnboardCall = (
  name: string,
  args: ObjectValue,
  signal: AbortSignal,
) => Promise<unknown>;

export async function wizardDue(call: OnboardCall, signal: AbortSignal): Promise<boolean | null> {
  try {
    const result = object(await call(tool("me"), { action: "readiness" }, signal));
    if (result && !result.isError) {
      const due = object(payload(result))?.wizard_due;
      if (typeof due === "boolean") return due;
    }
  } catch {
    /* Old MCPs have no readiness. A complete list can still witness absence. */
  }
  signal.throwIfAborted();
  try {
    const result = object(await call(tool("realm"), { action: "list" }, signal));
    return result && !result.isError ? emptyList(result) : null;
  } catch {
    return null;
  }
}
