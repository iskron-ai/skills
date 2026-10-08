// Имя продукта и всё, что из него выводится (граф @nks/nks-dev, узлы #6809, #6815):
// две поставки на одной машине не сталкиваются, пока каждое имя здесь выведено из
// своего PRODUCT — дом и грант, переменные окружения, сокеты и pipes, файлы, клиенты.
import { DEFAULT_LANG, type Lang } from "./lang.ts";

/** Имя продукта — строчными, как в имени дома, файлов и клиентов. */
export const PRODUCT = "iskron";
/** Имя продукта в регулярном выражении и в именах переменных. */
const UPPER = PRODUCT.toUpperCase();

/** Префикс переменных окружения поставки; по нему демон берёт окружение сессии. */
export const ENV_PREFIX = `${UPPER}_`;
/** Имя переменной окружения поставки: `envName("BRIDGE_URL")` — `ISKRON_BRIDGE_URL`. */
export const envName = (suffix: string): string => `${ENV_PREFIX}${suffix}`;

/** Имя моста — клиент MCP, user-agent, каталог дома. */
export const BRIDGE_NAME = `${PRODUCT}-bridge`;
/** Каталог дома под домашним каталогом пользователя: грант, сокеты, домашняя копия моста. */
export const HOME_DIR = `.${BRIDGE_NAME}`;
/** Имя домашней копии моста — контракт с конфигами харнесов. */
export const HOME_BRIDGE_FILE = `${BRIDGE_NAME}.mjs`;
/** Короткий личный каталог сокетов в /tmp и pipes Windows: `<префикс>-…`. */
export const RUNTIME_PREFIX = PRODUCT;
/** Ключ реестров процесса в globalThis (два плагина в одном процессе OpenCode). */
export const GLOBAL_PREFIX = `__${PRODUCT}`;

/** Скилл, несущий мост, и файл моста в его `scripts/`: по ним узнаётся корень набора (#6847). */
export const BRIDGE_SKILL = "establish-mcp";
export const BRIDGE_FILE = `${PRODUCT}.mjs`;
/** Файл плагина OpenCode в поставке (рядом с мостом) и имя его копии в `plugins/` OpenCode. */
export const PLUGIN_FILE = "opencode-plugin.js";
export const PLUGIN_COPY_FILE = `${PRODUCT}.js`;
/**
 * Маска отпечатка набора от его корня: `*` — каталог скилла, затем путь файла внутри
 * скилла или `**` — все файлы скилла. Здесь меряется SKILL.md каждого скилла.
 */
export const SKILL_STAMP_MASK = "*/SKILL.md";
/** Набор скиллов поставки: источник `npx skills`, репозиторий выпусков. */
export const SKILL_SET = "iskron-ai/skills";

/** Плагин Claude Code и Codex: `<имя>@<маркетплейс>`; имя MCP-записи — то же имя продукта. */
export const PLUGIN_NAME = PRODUCT;
/** Запись моста-спутника субагента: `<префикс>-<роль>`. */
export const SUB_ENTRY_PREFIX = `${PRODUCT}-sub`;
/** Запись MCP, ведущая к этой поставке, — по имени или команде (doctor). */
export const CONNECTOR_PATTERN = /iskron|искрон|\bnks\b/i;

/** Имена клиентов MCP, которыми представляются части поставки. */
export const CLIENTS = {
  opencode: `opencode-${PRODUCT}`,
  pi: `pi-${PRODUCT}`,
  doctor: `${PRODUCT}-doctor`,
  watchdog: `${PRODUCT}-watchdog`,
} as const;

/** Продовые адреса сервера по языку (#5040); умолчание — адрес языка по умолчанию. */
export const SERVER_URLS: Readonly<Record<Lang, string>> = {
  ru: "https://mcp.iskron.ru/",
  en: "https://mcp.iskron.ai/",
};
export const DEFAULT_SERVER_URL = SERVER_URLS[DEFAULT_LANG];

// part 6
/**
 * Код `node -e` единой формы записи моста-спутника: путь к дому из homedir, путь в
 * argv[1], импорт моста. Эталон: копии в ролевых файлах и delegation.md сверяет
 * с ним `make validate` (норма — skills/iskronify/references/delegation.md).
 */
export const SATELLITE_CODE =
  "const p=require('path').join(require('os').homedir(),'.iskron-bridge','iskron-bridge.mjs');process.argv.splice(1,0,p);import(require('url').pathToFileURL(p).href)";
/** Имя раздела хуков в скилле бутстрапа поставки — на языке слов. */
export const HOOKS_SECTION: Readonly<Record<Lang, string>> = { ru: "Хуки", en: "Hooks" };
