// Pure evidence helpers; no model, credentials or graph access on import.
export const SUB_TOOL = /^(task|subagent)$/;
export const roleOf = (p) => p.state?.input?.agent ?? p.state?.input?.subagent_type ?? p.state?.input?.subagent ?? "?";
export const toolParts = (msgs) => msgs.flatMap((x) => (x.content ?? []).filter((p) => p.type === "tool"));
export const has45 = (text) => /(?<![\d#])45(?!\d)/.test(text);
export function turnMinutes(value = "15") {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 60) throw new Error("--turn-minutes must be between 1 and 60");
  return n;
}
export const locationPath = (path, cwd) => ["/api/skill", "/api/agent"].includes(path)
  ? `${path}?location[directory]=${encodeURIComponent(cwd)}` : path;
export function actualModels(msgs) {
  return [...new Set(msgs.filter((x) => (x.type ?? x.role) === "assistant")
    .map((x) => x.model ? JSON.stringify(x.model) : x.providerID && x.modelID ? `${x.providerID}/${x.modelID}` : null).filter(Boolean))];
}
export function sessionTree(id, rootMessages, messages) {
  const sessions = [{ sessionID: id, parentID: null, role: "root", messages: rootMessages }];
  const blockers = [];
  for (const s of sessions) for (const p of toolParts(s.messages).filter((p) => SUB_TOOL.test(p.name))) {
    const childID = p.state?.metadata?.sessionID;
    if (typeof childID !== "string" || !/^ses[\w-]+$/.test(childID)) {
      blockers.push(`${s.sessionID}: ${roleOf(p)} has no usable observed metadata.sessionID`);
      continue;
    }
    if (sessions.some((x) => x.sessionID === childID)) continue;
    try { sessions.push({ sessionID: childID, parentID: s.sessionID, role: roleOf(p), messages: messages(childID) }); }
    catch (e) { blockers.push(e.message); }
  }
  return { sessions, blockers };
}
export function seatID(board, name) {
  const lines = board.split("\n");
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(`:${name} —`)) {
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      if (/^\s*\S+:\S+ —/.test(lines[j])) break;
      const id = lines[j].match(/\bid ([0-9a-f-]{36})/i)?.[1];
      if (id) return id;
    }
  }
  return null;
}
export function secretScrubber(token) {
  const secrets = new Set([token]);
  const remember = (value, key = "") => {
    if (typeof value === "string" && /key|token|password|secret|authorization/i.test(key)) secrets.add(value);
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) remember(v, k);
  };
  const scrub = (text) => [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)
    .reduce((s, v) => s.split(v).join("<secret>"), String(text))
    .replace(/\bnks_chh_[A-Za-z0-9_-]+/g, "<secret>")
    .replace(/(Bearer\s+)[^\s"\\]+/gi, "$1<secret>")
    .replace(/("(?:apiKey|api_key|access_token|refresh_token|ws_token|wsToken|token|password|secret)"\s*:\s*")[^"]*/gi, "$1<secret>")
    .replace(/((?:[?&]|\b)(?:access_token|refresh_token|ws_token|token|api_key|apiKey|password)=)[^\s&#"\\]+/gi, "$1<secret>")
    .replace(/((?:ws[ -]?token|access[ -]?token|refresh[ -]?token|api[ -]?key|PAT)\s*[:=]\s*)[^\s,;"\\]+/gi, "$1<secret>");
  return { secrets, remember, scrub };
}
