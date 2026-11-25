// Words of the context recovery gate (#10121); separate from shared delivery dictionaries.
import type { Lang } from "./lang.ts";

export const CONTEXT_DOOR = "iskron";

export const CONTEXT_GATE: Readonly<
  Record<
    Lang,
    { refused: string; confirmed: string; field: string; storage: (why: string) => string }
  >
> = {
  ru: {
    storage: (why) =>
      `Ограда контекста не сохранена или не прочитана: ${why}. Запись не отправлена; чтение доступно. Ошибка хранения не подтверждает готовность.`,
    refused:
      "Возможно, контекст сжат (эвристика обвала заполненности). Запись не отправлена. Загрузи скилл iskron (дверь), затем повтори. Чтение доступно. Если загрузка не наблюдаема, явно подтверди перечитывание: iskron_stand(realm=<свой граф>, context_restored=true).",
    confirmed:
      "Перечитывание явно подтверждено для своего места и текущего поколения; запись разрешена.",
    field:
      "Явно подтвердить перечитывание двери (скилла iskron) после обвала контекста. Только своё уже удерживаемое место; локально, без register и нового стояния.",
  },
  en: {
    storage: (why) =>
      `Context recovery metadata could not be saved or read: ${why}. The write was not sent; reads remain available. Storage failure does not confirm readiness.`,
    refused:
      "Context may have been compacted (fill-collapse heuristic). The write was not sent. Load the iskron skill (the door), then retry. Reads remain available. If loading is not observable, explicitly confirm rereading: iskron_stand(realm=<your graph>, context_restored=true).",
    confirmed:
      "Rereading explicitly confirmed for this seat and recovery generation; writes are allowed.",
    field:
      "Explicitly confirm rereading the door (the iskron skill) after a context collapse. Only your already held seat; local, without register or taking a new seat.",
  },
};
