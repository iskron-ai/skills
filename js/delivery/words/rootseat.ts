// Слова автопосадки корня по обложке проекта (ядро opencode/rootseat.ts, shared/cover.ts):
// одна строка модели до первого запроса — встал или почему не встал. Нет файла обложки вне
// репозитория — слова нет вовсе.
import type { Lang } from "../lang.ts";

export interface RootSeatWords {
  // Почему обложка не назвала место; file и key — имена из patterns/cover.ts.
  /** Файла обложки нет в каталоге сессии внутри репозитория. */
  noFile: (file: string) => string;
  noFrontmatter: (file: string) => string;
  noKey: (file: string, key: string) => string;
  /** Нет ключей ни одной формы обложки; keys — слоты графа всех форм, списком в кавычках. */
  noForm: (file: string, keys: string) => string;
  /** Ключи нескольких языковых форм сразу; keys — слоты графа найденных форм, списком. */
  manyForms: (file: string, keys: string) => string;
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
  unproven: () => string;
  /** Не встал: why — причина готовой строкой. */
  notSeated: (why: string) => string;
  /** Не встал из-за дефекта обложки file: выровнять, посадка повторится сама. */
  realign: (why: string, file: string) => string;
  /** Отказ моста или сервера на посадке — причина его словами. */
  refused: (text: string) => string;
  /** Вернулось своё прежнее место сессии, но другой роли или графа, чем в обложке. */
  ownOther: (place: string, karta: string, realm: string) => string;
  heldUncompared: (place: string, karta: string, held: string, cover: string) => string;
  unknownRealm: () => string;
  uncompared: (cover: string, held: string) => string;
  /** Посадка не уложилась в срок; запрос идёт без места. */
  late: (seconds: number) => string;
  /** У плагина нет моста. */
  noBridge: () => string;
}

export const ROOT_SEAT: Readonly<Record<Lang, RootSeatWords>> = {
  ru: {
    noFile: (file) => `нет ${file}`,
    noFrontmatter: (file) => `в ${file} нет YAML-фронтматтера обложки`,
    noKey: (file, key) => `в обложке ${file} нет слота '${key}'`,
    noForm: (file, keys) => `в обложке ${file} нет ни одного из слотов ${keys}`,
    manyForms: (file, keys) => `обложка ${file} смешивает языки: ${keys} сразу`,
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
    unproven: () =>
      "мост не подтвердил, что это провизорное место взято этой попыткой; revoke не разрешён",
    notSeated: (why) =>
      `Искрон: сессия не посажена — ${why}; место — словом человека или iskron_stand.`,
    realign: (why, file) =>
      `Искрон: сессия не посажена — ${why}. Выровняй репозиторий скиллом iskronify по действительным источникам; граф или роль не угадывай — неопределимое спроси по процедуре выравнивания. Посадка повторится сама, как только обложка ${file} станет однозначной.`,
    refused: (text) => `посадка сорвалась: ${text}`,
    ownOther: (place, karta, realm) =>
      `Искрон: сессия держит место ${place} — роль #${karta} в ${realm}; роль или граф не совпадают с обложкой. Для смены — iskron_stand с take либо явное снятие текущего места (revoke).`,
    heldUncompared: (place, karta, held, cover) =>
      `Искрон: сессия держит место ${place} — роль #${karta}, ${held}; граф не сличён с ${cover} в обложке. Для смены — iskron_stand с take либо явное снятие текущего места (revoke).`,
    unknownRealm: () => "граф неизвестен (запись держания недоступна)",
    uncompared: (cover, held) => `граф не сличён: ${cover} в обложке, ${held} у места`,
    late: (seconds) => `посадка не уложилась в ${seconds} с, запрос идёт без места`,
    noBridge: () => "мост не поднят",
  },
  en: {
    noFile: (file) => `there is no ${file}`,
    noFrontmatter: (file) => `${file} carries no YAML front matter`,
    noKey: (file, key) => `the front matter of ${file} has no '${key}' slot`,
    noForm: (file, keys) => `the front matter of ${file} has none of the slots ${keys}`,
    manyForms: (file, keys) => `the cover of ${file} mixes languages: ${keys} at once`,
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
    unproven: () =>
      "the bridge did not prove this attempt took a provisional seat; revoke is not authorized",
    notSeated: (why) =>
      `Iskron: the session is not seated — ${why}; a seat comes by the human's word or iskron_stand.`,
    realign: (why, file) =>
      `Iskron: the session is not seated — ${why}. Align the repository with the iskronify skill from valid sources; do not guess the graph or the role — ask what cannot be determined by the alignment procedure. Seating repeats by itself as soon as the cover ${file} becomes unambiguous.`,
    refused: (text) => `seating failed: ${text}`,
    ownOther: (place, karta, realm) =>
      `Iskron: the session holds seat ${place} — role #${karta} in ${realm}; its role or graph differs from the cover. To change seats, use iskron_stand with take or explicitly revoke the held seat.`,
    heldUncompared: (place, karta, held, cover) =>
      `Iskron: the session holds seat ${place} — role #${karta}, ${held}; its graph is not compared with ${cover} in the cover. To change seats, use iskron_stand with take or explicitly revoke the held seat.`,
    unknownRealm: () => "graph unknown (hold record unavailable)",
    uncompared: (cover, held) => `graph not compared: ${cover} in the cover, ${held} on the seat`,
    late: (seconds) => `seating did not finish in ${seconds} s, the request goes without a seat`,
    noBridge: () => "no bridge raised",
  },
};
