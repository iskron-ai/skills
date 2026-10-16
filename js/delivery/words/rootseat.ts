// Слова автопосадки корня по обложке проекта (ядро opencode/rootseat.ts, shared/cover.ts):
// одна строка модели до первого запроса — встал или почему не встал. Нет файла обложки —
// слова нет вовсе: проект не выровнен.
import type { Lang } from "../lang.ts";

export interface RootSeatWords {
  // Почему обложка не назвала место; file и key — имена из patterns/cover.ts.
  noFrontmatter: (file: string) => string;
  noKey: (file: string, key: string) => string;
  /** В значении слота нет ни @owner/slug, ни rN в начале. */
  noGraph: (file: string, key: string) => string;
  /** В значении слота графа — несколько разных графов. */
  manyGraphs: (file: string, key: string, list: string) => string;
  /** Значение слота роли не начинается ссылкой; ref — её вид в кавычках поставки. */
  noRoleRef: (file: string, key: string, ref: string) => string;
  /** В значении слота роли — несколько ссылок на роли. */
  manyRoles: (file: string, key: string, list: string) => string;
  /** Встал: place — имя места, realm и karta — из обложки. */
  seated: (place: string, karta: string, realm: string, file: string) => string;
  ownSeated: (place: string, karta: string, realm: string, file: string) => string;
  cancelled: () => string;
  cleanupFailed: (place: string, why: string) => string;
  /** Не встал: why — причина готовой строкой. */
  notSeated: (why: string) => string;
  /** Отказ моста или сервера на посадке — причина его словами. */
  refused: (text: string) => string;
  /** Вернулось своё прежнее место сессии, но другой роли или графа, чем в обложке. */
  ownOther: (place: string, karta: string, realm: string) => string;
  uncompared: (cover: string, held: string) => string;
  /** Посадка не уложилась в срок; запрос идёт без места. */
  late: (seconds: number) => string;
  /** У плагина нет моста. */
  noBridge: () => string;
}

export const ROOT_SEAT: Readonly<Record<Lang, RootSeatWords>> = {
  ru: {
    noFrontmatter: (file) => `в ${file} нет YAML-фронтматтера обложки`,
    noKey: (file, key) => `в обложке ${file} нет слота '${key}'`,
    noGraph: (file, key) => `'${key}' в ${file} не начинается с @owner/slug или rN`,
    manyGraphs: (file, key, list) => `'${key}' в ${file} называет несколько графов: ${list}`,
    noRoleRef: (file, key, ref) => `'${key}' в ${file} не начинается ссылкой ${ref}`,
    manyRoles: (file, key, list) => `'${key}' в ${file} называет несколько ролей: ${list}`,
    seated: (place, karta, realm, file) =>
      `Искрон: сессия стоит местом ${place} — роль #${karta} в ${realm}, по ${file}; записи подписаны этим местом. Для вахты (room/model) или своего имени вызови iskron_stand — предварительное место он заменит без take.`,
    ownSeated: (place, karta, realm, file) =>
      `Искрон: сессия стоит своим местом ${place} — роль #${karta} в ${realm}, по ${file}; записи подписаны им. Другое имя — iskron_stand с take.`,
    cancelled: () => "Экземпляр или сессия остановлены; новая посадка запрещена.",
    cleanupFailed: (place, why) =>
      `Отменённая посадка ${place}: снять место не удалось (${why}); мост закрывается, место может остаться до простоя на сервере.`,
    notSeated: (why) =>
      `Искрон: сессия не посажена — ${why}; место — словом человека или iskron_stand.`,
    refused: (text) => `посадка сорвалась: ${text}`,
    ownOther: (place, karta, realm) =>
      `вернулось своё прежнее место ${place} другой роли или графа (#${karta} в ${realm}), чем в обложке`,
    uncompared: (cover, held) => `граф не сличён: ${cover} в обложке, ${held} у места`,
    late: (seconds) => `посадка не уложилась в ${seconds} с, запрос идёт без места`,
    noBridge: () => "мост не поднят",
  },
  en: {
    noFrontmatter: (file) => `${file} carries no YAML front matter`,
    noKey: (file, key) => `the front matter of ${file} has no '${key}' slot`,
    noGraph: (file, key) => `'${key}' in ${file} does not start with @owner/slug or rN`,
    manyGraphs: (file, key, list) => `'${key}' in ${file} names several graphs: ${list}`,
    noRoleRef: (file, key, ref) => `'${key}' in ${file} does not start with a ${ref} reference`,
    manyRoles: (file, key, list) => `'${key}' in ${file} names several roles: ${list}`,
    seated: (place, karta, realm, file) =>
      `Iskron: the session holds seat ${place} — role #${karta} in ${realm}, per ${file}; writes are signed by this seat. For a watch (room/model) or your own name, call iskron_stand — it replaces a provisional seat without take.`,
    ownSeated: (place, karta, realm, file) =>
      `Iskron: the session holds its own seat ${place} — role #${karta} in ${realm}, per ${file}; writes are signed by it. A different name requires iskron_stand with take.`,
    cancelled: () => "The instance or session is stopped; no new seating is allowed.",
    cleanupFailed: (place, why) =>
      `Cancelled seating ${place}: could not revoke the seat (${why}); the bridge is closing, the seat may remain until the server's idle expiry.`,
    notSeated: (why) =>
      `Iskron: the session is not seated — ${why}; a seat comes by the human's word or iskron_stand.`,
    refused: (text) => `seating failed: ${text}`,
    ownOther: (place, karta, realm) =>
      `the session's own previous seat ${place} returned in another role or graph (#${karta} in ${realm}) than the cover's`,
    uncompared: (cover, held) => `graph not compared: ${cover} in the cover, ${held} on the seat`,
    late: (seconds) => `seating did not finish in ${seconds} s, the request goes without a seat`,
    noBridge: () => "no bridge raised",
  },
};
