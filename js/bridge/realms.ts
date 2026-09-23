// Один граф — одно имя (граф nks-dev: #5838). Граф пишут тремя способами:
// @owner/slug (так его печатают кадры и hello), короткий id rN и голый slug.
// Сравнивать можно только каноническую форму @owner/slug: сомнение «тот же
// граф» — не ответ, иначе r5 и чужой слаг слились бы в одно место. Короткий id
// места узнаётся прежде всего из hello (standings[].realm всегда @owner/slug,
// places.ts); список графов (iskron_realm list) — запасной путь, когда сличать
// надо раньше hello. Неразрешённое имя — само по себе, не «тот же граф».

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
