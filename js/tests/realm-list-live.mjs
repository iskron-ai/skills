// Anonymised production response supplied by the reviewer, 2026-10-17 (~00:40Z).
import { readFileSync } from "node:fs";

export const LIVE_REALM_LIST = readFileSync(
  new URL("./realm-list-live.txt", import.meta.url),
  "utf8",
);
export function liveListVariant(kind, archived = true) {
  let text = LIVE_REALM_LIST;
  if (kind === "personal")
    text = text
      .split("\n")
      .filter(
        (line) =>
          !line.startsWith("▸ @acme") &&
          (!line.startsWith("    @") || /^ {4}@(ivan|petr)\/mind /.test(line)),
      )
      .join("\n");
  if (kind === "org-mind")
    text = text
      .split("\n")
      .filter(
        (line) =>
          !line.startsWith("    @") ||
          line.startsWith("    @acme/mind ") ||
          /^ {4}@(ivan|petr)\/mind /.test(line),
      )
      .join("\n");
  const n = text.split("\n").filter((line) => line.startsWith("    @")).length;
  text = text.replace(/Доступные графы \(\d+\)/, `Доступные графы (${n})`);
  if (!archived)
    text = text
      .split("\n")
      .filter((line) => !line.startsWith("🗄"))
      .join("\n");
  return text;
}
