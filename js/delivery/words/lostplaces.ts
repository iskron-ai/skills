// Слова потери места при смене демона машины (тонкий мост, граф @nks/nks-dev, узел #5838).
import type { Lang } from "../lang.ts";

export interface LostWords {
  satellite: (key: string) => string;
  seat: (key: string, realm: string, why: string) => string;
}

export const LOST: Readonly<Record<Lang, LostWords>> = {
  ru: {
    satellite: (key) =>
      `Отказано (мост): место спутника потеряно при смене демона машины (${key}) — у места спутника нет записи держания, и записи легли бы без автора; вызов не отправлен. Встань снова: iskron_stand с satellite_of.`,
    seat: (key, realm, why) =>
      `Отказано (мост): место ${key} (граф ${realm}) не вернулось после смены демона машины (${why}) — записи легли бы без автора; вызов не отправлен. Верни место: iskron_stand в этом графе тем же именем.`,
  },
  en: {
    satellite: (key) =>
      `Refused (bridge): the satellite's seat was lost in the machine daemon's change (${key}) — a satellite seat has no holding record, and writes would go unattributed; the call was not sent. Stand again: iskron_stand with satellite_of.`,
    seat: (key, realm, why) =>
      `Refused (bridge): the seat ${key} (graph ${realm}) did not come back after the machine daemon's change (${why}) — writes would go unattributed; the call was not sent. Bring it back: iskron_stand in that graph with the same name.`,
  },
};
