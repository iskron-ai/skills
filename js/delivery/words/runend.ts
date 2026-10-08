// Слова конца прогона (граф @nks/nks-dev, узел #6593): причина ухода, когда
// конец позвал плагин.
import type { Lang } from "../lang.ts";

export interface RunEndWords {
  pluginEnd: () => string;
}

export const RUN_END: Readonly<Record<Lang, RunEndWords>> = {
  ru: {
    pluginEnd: () => "конец прогона по слову плагина",
  },
  en: {
    pluginEnd: () => "the run's end on the plugin's word",
  },
};
