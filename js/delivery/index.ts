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
// part 5a
export { BOARD_FORM } from "./patterns/board.ts";
export { CASE_EXIT_CLOSED } from "./patterns/caseexit.ts";
export { SERVER_CHOICE } from "./patterns/config.ts";
export { NOTICE_MARK } from "./patterns/deliver.ts";
export { ABSORB, type AbsorbWords } from "./words/absorb.ts";
export { BACKLOG, type BacklogWords } from "./words/backlog.ts";
export { CALL, type CallWords } from "./words/call.ts";
export { DEAF, type DeafWords } from "./words/deaf.ts";
export { DOOR, type DoorWords } from "./words/door.ts";
export { HANDOFF, type HandoffWords } from "./words/handoff.ts";
export { HEARING, type HearingWords } from "./words/hearing.ts";
export { HOOK, type HookWords } from "./words/hook.ts";
