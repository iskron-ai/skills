// Имена, которыми наши собственные клиенты моста называют себя в рукопожатии.
// Они поднимают мост сами — лениво, повторно после простоя — и отказ
// рукопожатия со ссылкой входа читают сами, показывая человеку строку в своём
// окне. Мост по этим именам отличает их от харнеса, чьё рукопожатие делает
// человек у экрана (граф nks-dev: #4790).
export const OPENCODE_CLIENT = "opencode-iskron";
export const PI_CLIENT = "pi-iskron";
export const OWN_CLIENTS: ReadonlySet<string> = new Set([OPENCODE_CLIENT, PI_CLIENT]);
