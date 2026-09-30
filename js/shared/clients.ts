// Имена наших собственных клиентов моста, которые отказ рукопожатия со ссылкой
// входа читают сами и ждут входа, повторяя рукопожатие: плагин OpenCode —
// поднимает мост лениво и повторно после простоя, строку входа пишет в stderr
// сервиса и отдаёт тулом iskron_bridge; выгрузка снимка поверхности (`make surface`) — снимок,
// записанный из старого ответа при мёртвом гранте, выдал бы себя за живую
// поверхность (при отказе сети последний ответ по-прежнему получают все
// клиенты, этот тоже — граф nks-dev: #4664). Мост по этим именам
// оставляет им прежний отказ рукопожатия; прочее рукопожатие — харнеса,
// то есть человека у экрана (граф nks-dev: #4790). Расширение pi отказ входа
// читает и ждёт (js/extension/tools.ts, #4795), но в этот список не входит
// нарочно: при мёртвом гранте с сохранённым ответом ему, как харнесу, отдаётся
// кэш — тулы стоят с первой секунды, ссылку входа несёт первый вызов; отказ оно
// встречает только на пустом кэше, то есть на самом первом входе за адрес.
export const OPENCODE_CLIENT = "opencode-iskron";
export const SURFACE_CLIENT = "export-surface"; // scripts/export-surface.mjs, литералом: .mjs не берёт TS
export const OWN_CLIENTS: ReadonlySet<string> = new Set([OPENCODE_CLIENT, SURFACE_CLIENT]);

// Клиенты, которым кадр стояния доходит уведомлением MCP, а не локальным
// сторожем: расширение pi и плагин OpenCode. Остальным (Claude Code, Codex)
// кадр доходит только через сторожа — без него мост глух, и уходит с места
// сам (bridge/leave.ts, граф nks-dev: #4895).
export const PI_CLIENT = "pi-iskron";
export const NOTIFIED_CLIENTS: ReadonlySet<string> = new Set([PI_CLIENT, OPENCODE_CLIENT]);

// Версия хоста для attrs.harness_version (граф nks-dev: #6226). Плагину OpenCode
// и расширению pi клиент рукопожатия — они сами, и clientInfo.version — их версия,
// не хоста: версию OpenCode и pi они передают мосту этой переменной при запуске.
export const HARNESS_VERSION_ENV = "ISKRON_HARNESS_VERSION";
// Корень набора скиллов для attrs.skills (#6226): мост вне набора (домашняя копия)
// узнаёт набор только этой переменной — её ставят плагин OpenCode и расширение pi.
export const SKILLS_ROOT_ENV = "ISKRON_SKILLS_ROOT";
export const HOSTED_CLIENTS: ReadonlySet<string> = new Set([PI_CLIENT, OPENCODE_CLIENT]);
