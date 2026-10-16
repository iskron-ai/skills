// Read-only account evidence for the first prompt. Unknown never invites.
import {
  REALM_LIST_GROUP,
  REALM_LIST_HEADER,
  REALM_LIST_ORG,
  REALM_LIST_ROW,
  tool,
} from "../delivery/index.ts";

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

function noWork(refs: unknown[], organizations = new Set<string>()): boolean | null {
  if (!refs.every((r) => typeof r === "string" && /^@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r)))
    return null;
  return refs.every(
    (r) =>
      (r as string).endsWith("/mind") && !organizations.has((r as string).split("/")[0].slice(1)),
  );
}

/** Only a complete, recognisable list is evidence of absence. */
function emptyList(v: ObjectValue): boolean | null {
  if ("structuredContent" in v) {
    const fields = object(v.structuredContent);
    if (
      !fields ||
      fields.incomplete === true ||
      (fields.dropped !== undefined && fields.dropped !== 0)
    )
      return null;
    if (fields.action !== undefined && fields.action !== "list") return null;
    const realms = fields.realms;
    return Array.isArray(realms) ? noWork(realms.map((r) => object(r)?.ref)) : null;
  }
  const text = textOf(v);
  const header = REALM_LIST_HEADER.exec(text);
  if (!header || text.slice(0, header.index).trim()) return null;
  const refs: string[] = [];
  const organizations = new Set<string>();
  for (const line of text.slice(header.index + header[0].length).split(/\r?\n/)) {
    const organization = REALM_LIST_ORG.exec(line);
    if (organization) organizations.add(organization[1]);
    if (!line.trim() || REALM_LIST_GROUP.test(line)) continue;
    const row = REALM_LIST_ROW.exec(line);
    if (!row) return null;
    refs.push(row[1]);
  }
  if (refs.length !== Number(header[1]) || new Set(refs).size !== refs.length) return null;
  return noWork(refs, organizations);
}

export type OnboardCall = (
  name: string,
  args: ObjectValue,
  signal: AbortSignal,
) => Promise<unknown>;

export async function wizardDue(call: OnboardCall, signal: AbortSignal): Promise<boolean> {
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
    return !!result && !result.isError && emptyList(result) === true;
  } catch {
    return false;
  }
}
