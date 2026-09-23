// Один граф — одно имя (граф nks-dev: #5838). Граф пишут тремя способами:
// @owner/slug (так его печатают кадры и hello), короткий id rN и голый slug.
// Сравнивать можно только каноническую форму @owner/slug: сомнение «тот же
// граф» — не ответ, иначе r5 и чужой слаг слились бы в одно место. Короткий id
// места узнаётся прежде всего из hello (standings[].realm всегда @owner/slug,
// places.ts); список графов (iskron_realm list) — запасной путь, когда сличать
// надо раньше hello. Неразрешённое имя — само по себе, не «тот же граф».

const aliases = new Map<string, string>(); // rN или slug → @owner/slug
let listing: Promise<void> | null = null; // чтение списка в полёте — одно на всех ждущих

const CANON_RE = /@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/;
const trimmed = (r: unknown): string => String(r ?? "").trim();

/** Каноническая форма графа — @owner/slug; неразрешённое имя остаётся собой (и не равно ничему иному). */
export function canonRealm(r: unknown): string {
  const t = trimmed(r);
  if (t.startsWith("@")) return t;
  return aliases.get(t) ?? t;
}

/** Разрешено ли имя графа в @owner/slug. */
export const resolvedRealm = (r: unknown): boolean => canonRealm(r).startsWith("@");

/**
 * Отношение двух имён графа: тот же, другой — или не известно. Одно и то же
 * написание — тот же граф; иначе судят только канонические формы, а имя, не
 * разрешённое в @owner/slug, даёт «не известно»: ни место рядом, ни правило
 * одного места на нём не держатся — вызов отказывается вслух (#5838).
 */
export function realmRelation(a: unknown, b: unknown): "same" | "other" | "unknown" {
  const x = trimmed(a);
  const y = trimmed(b);
  if (x && x === y) return "same";
  if (!resolvedRealm(x) || !resolvedRealm(y)) return "unknown";
  return canonRealm(x) === canonRealm(y) ? "same" : "other";
}

/** Тот же ли граф наверняка. */
export const sameRealm = (a: unknown, b: unknown): boolean => realmRelation(a, b) === "same";

/** Другой ли граф наверняка: оба названы и разрешены в разные @owner/slug. */
export const otherRealm = (a: unknown, b: unknown): boolean =>
  !!trimmed(a) && !!trimmed(b) && realmRelation(a, b) === "other";

/** Не известно, тот ли граф: имя не разрешилось — вызов отказывается, не гадает. */
export const unknownRealm = (a: unknown, b: unknown): boolean =>
  !!trimmed(a) && !!trimmed(b) && realmRelation(a, b) === "unknown";

/** Слово отказа по неразрешённому имени графа; held — места моста в канонической форме. */
export const unresolvedWord = (realm: unknown, held: string[]): string =>
  `Отказано (мост): граф «${trimmed(realm)}» мост не разрешил в @owner/slug (списка графов нет или имени в нём нет) — тот ли это граф, что у мест моста (${held.join(", ")}), не известно, и гадать нельзя. Повтори вызов с полным адресом графа @owner/slug.`;

/** Запомнить, что это имя графа — такой-то @owner/slug (hello, список графов). */
export function learnRealm(alias: unknown, canonical: string): void {
  const t = trimmed(alias);
  if (t && !t.startsWith("@") && CANON_RE.test(canonical)) aliases.set(t, canonical);
}

/**
 * Разобрать текст тула iskron_realm(action="list") — строка графа такова:
 * `    @owner/slug  rN  имя · дата` (четыре пробела, по два между полями).
 * Связывает rN с @owner/slug; голый slug — тоже имя графа, если он в списке один.
 */
const LIST_LINE_RE = /^ {4}(@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+) {2}(r\d+) {2}.* · /;
export function learnRealmList(text: string): void {
  const slugs = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    const m = LIST_LINE_RE.exec(line);
    if (!m) continue;
    const [, c, short] = m;
    learnRealm(short, c);
    const slug = c.replace(/^@[^/]+\//, "");
    slugs.set(slug, [...new Set([...(slugs.get(slug) ?? []), c])]);
  }
  for (const [slug, cs] of slugs) if (cs.length === 1) learnRealm(slug, cs[0]);
}

/**
 * Разрешить имена графов в каноническую форму: есть неразрешённое — список
 * графов перечитывается (граф мог появиться после прошлого чтения); прочтённое
 * не держится навсегда отрицательным ответом. `list` — вызов iskron_realm list.
 */
export async function resolveRealms(
  names: unknown[],
  list: () => Promise<string | null>,
): Promise<void> {
  const open = names.map(trimmed).filter((t) => t && !resolvedRealm(t));
  if (!open.length) return;
  listing ??= list()
    .then(
      (text) => {
        if (text) learnRealmList(text);
      },
      () => {},
    )
    .finally(() => {
      listing = null;
    });
  await listing;
}
