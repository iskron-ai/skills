// Один граф — одно имя (граф nks-dev: #5838). Граф пишут тремя способами:
// @owner/slug (так его печатают кадры и hello), короткий id rN и голый slug.
// Сравнивать можно только каноническую форму @owner/slug: сомнение «тот же
// граф» — не ответ, иначе r5 и чужой слаг слились бы в одно место. Короткие
// id и голые слаги разрешаются по списку графов (iskron_realm list) и по hello
// (его standings[] несут граф в канонической форме); неразрешённое — само по себе.

const aliases = new Map<string, string>(); // rN или slug → @owner/slug
let listed: Promise<void> | null = null;

const CANON_RE = /@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/;
const trimmed = (r: unknown): string => String(r ?? "").trim();

/** Каноническая форма графа — @owner/slug; неразрешённое имя остаётся собой (и не равно ничему иному). */
export function canonRealm(r: unknown): string {
  const t = trimmed(r);
  if (t.startsWith("@")) return t;
  return aliases.get(t) ?? t;
}

/** Тот же ли граф — только по канонической форме; пустое не равно ничему. */
export function sameRealm(a: unknown, b: unknown): boolean {
  const x = canonRealm(a);
  return !!x && x === canonRealm(b);
}

/** Другой ли граф: оба названы и канонически различны (неразрешённое имя — другое, не «тот же»). */
export const otherRealm = (a: unknown, b: unknown): boolean =>
  !!trimmed(a) && !!trimmed(b) && !sameRealm(a, b);

/** Запомнить, что это имя графа — такой-то @owner/slug (hello, список графов). */
export function learnRealm(alias: unknown, canonical: string): void {
  const t = trimmed(alias);
  if (t && !t.startsWith("@") && CANON_RE.test(canonical)) aliases.set(t, canonical);
}

/**
 * Разобрать ответ списка графов: строка, несущая один @owner/slug и один rN,
 * связывает их; slug канонической формы — тоже имя графа, если он в списке один.
 */
export function learnRealmList(text: string): void {
  const slugs = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    const canon = line.match(new RegExp(CANON_RE.source, "g")) ?? [];
    if (canon.length !== 1) continue;
    const c = canon[0];
    const short = line.match(/(?<![\w/@-])r\d+(?![\w-])/g) ?? [];
    if (short.length === 1) learnRealm(short[0], c);
    const slug = c.replace(/^@[^/]+\//, "");
    slugs.set(slug, [...new Set([...(slugs.get(slug) ?? []), c])]);
  }
  for (const [slug, cs] of slugs) if (cs.length === 1) learnRealm(slug, cs[0]);
}

/**
 * Разрешить имена графов в каноническую форму — один раз спросив список
 * графов, если среди них есть неразрешённое. `list` — вызов iskron_realm list.
 */
export async function resolveRealms(
  names: unknown[],
  list: () => Promise<string | null>,
): Promise<void> {
  const open = names.map(trimmed).filter((t) => t && !t.startsWith("@") && !aliases.has(t));
  if (!open.length) return;
  listed ??= list().then(
    (text) => {
      if (text) learnRealmList(text);
      else listed = null; // список не прочитался — спросить в следующий раз
    },
    () => {
      listed = null;
    },
  );
  await listed;
}
