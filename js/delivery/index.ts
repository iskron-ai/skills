// Слой поставки (граф @nks/nks-dev, узел #6809): ядро js/ берёт отсюда всё, чем
// поставка отличается, — этим одним путём.
export { DEFAULT_LANG, type Lang, langOfServer, LANGS } from "./lang.ts";
export {
  BRIDGE_FILE,
  BRIDGE_NAME,
  BRIDGE_SKILL,
  CLIENTS,
  CONNECTOR_PATTERN,
  DEFAULT_SERVER_URL,
  ENV_PREFIX,
  envName,
  GLOBAL_PREFIX,
  HOME_BRIDGE_FILE,
  HOME_DIR,
  PLUGIN_COPY_FILE,
  PLUGIN_FILE,
  PLUGIN_NAME,
  PRODUCT,
  RUNTIME_PREFIX,
  SERVER_URLS,
  SKILL_SET,
  SKILL_STAMP_FILE,
  SUB_ENTRY_PREFIX,
} from "./product.ts";
export { ID_PREFIX, LOGGERS, method, SERVER_PROTOCOL, tool, TOOL_PREFIX } from "./protocol.ts";
export { BUILD_MARK, CHANNEL_MARK, VERSION } from "./version.ts";
export { ASK, type AskWords } from "./words/asks.ts";
export { HOLD, type HoldWords } from "./words/hold.ts";
export {
  ROOM,
  ROOM_AUTO,
  ROOM_REL,
  type RoomAutoWords,
  type RoomRelWords,
  type RoomWords,
  VERDICT,
  type VerdictWords,
} from "./words/rooms.ts";
// part 6
export { HOOKS_SECTION, SATELLITE_CODE } from "./product.ts";
export { SAT_LOGIN_RE, SAT_OLD_FLAG_RE } from "./protocol.ts";
export { CLI, type CliWords } from "./words/cli.ts";
export { DOCTOR, type DoctorWords } from "./words/doctor.ts";
export { HARNESS, type HarnessWords } from "./words/doctorharness.ts";
export { RITUALS, type RitualWords } from "./words/rituals.ts";
export { SAT_PROBE, type SatProbeWords } from "./words/satprobe.ts";
export { SUBAGENT, type SubagentWords } from "./words/subagents.ts";
export { WATCHDOG, type WatchdogWords } from "./words/watchdog.ts";
