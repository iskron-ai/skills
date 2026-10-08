// Слой поставки (граф @nks/nks-dev, узел #6809): ядро js/ берёт отсюда всё, чем
// поставка отличается, — этим одним путём.
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
export {
  ID_PREFIX,
  LOGGERS,
  method,
  serverProtocol,
  STRUCTURED_CAPABILITY,
  tool,
  TOOL_PREFIX,
} from "./protocol.ts";
export { BUILD_MARK, CHANNEL_MARK, VERSION } from "./version.ts";
