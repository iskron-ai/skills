// Слова проверки личного каталога сокетов (ядро shared/standings.ts privateDirProblem).
import type { Lang } from "../lang.ts";

export interface StandingsWords {
  notDir: (dir: string) => string;
  otherUser: (dir: string) => string;
  openToOthers: (dir: string) => string;
}

export const STANDINGS: Readonly<Record<Lang, StandingsWords>> = {
  ru: {
    notDir: (dir) => `${dir} — не каталог`,
    otherUser: (dir) => `${dir} принадлежит другому пользователю`,
    openToOthers: (dir) => `${dir} открыт группе или прочим`,
  },
  en: {
    notDir: (dir) => `${dir} is not a directory`,
    otherUser: (dir) => `${dir} belongs to another user`,
    openToOthers: (dir) => `${dir} is open to group or others`,
  },
};
