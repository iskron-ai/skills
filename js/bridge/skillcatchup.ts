// Safe first step of #10122 (@nks/nks-dev). Missing pinned manifest/ownership proof
// is a refusal, never permission to run an unrestricted updater in a shared root.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { BRIDGE_SKILL, SKILL_CATCHUP, SKILL_SET } from "../delivery/index.ts";
import { PI_CLIENT } from "../shared/clients.ts";
import { words } from "../shared/lang.ts";
import { currentScope, envOf } from "../shared/scope.ts";
import { compareVersions, parseVersion } from "../shared/semver.ts";
import { skillLock } from "../shared/skilllock.ts";
import { VERSION } from "../shared/version.ts";
import { harnessName } from "./client.ts";
import { skillsAttr, skillsRoot } from "./skillset.ts";
import { skillMoves } from "./update.ts";

export function skillCatchupNotice(): string | null {
  const root = skillsRoot();
  const installed = skillsAttr();
  const before = parseVersion(installed.version);
  const target = parseVersion(VERSION);
  if (!root || !before || !target || compareVersions(installed.version, VERSION) >= 0) return null;
  const client = harnessName();
  const moves = skillMoves();
  const plugin =
    !!envOf("CLAUDE_PLUGIN_ROOT") ||
    existsSync(join(root, "..", ".claude-plugin", "plugin.json")) ||
    existsSync(join(root, "..", ".codex-plugin", "plugin.json"));
  const source = skillLock(root, envOf("XDG_STATE_HOME"))?.[BRIDGE_SKILL]?.source;
  const own = installed.name === SKILL_SET && source === SKILL_SET;
  const patchOnly = before[0] === target[0] && before[1] === target[1];
  const command = plugin
    ? client.includes("codex")
      ? moves.codex
      : moves.claude
    : !own
      ? `node ${JSON.stringify(currentScope().origin?.path || process.argv[1])} doctor`
      : client === PI_CLIENT
        ? moves.pi
        : moves.flat;
  const reason = plugin ? "plugin" : !own ? "ownership" : patchOnly ? "patch" : "manifest";
  return words(SKILL_CATCHUP).notice(
    root,
    installed.name,
    installed.version,
    VERSION,
    reason,
    command,
  );
}
