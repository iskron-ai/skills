// Фронтматтер файла агента — подмножество YAML, которым такие файлы пишут:
// карты, блочные списки (в том числе `- имя:` с картой под ним), списки в
// скобках, строки в двойных и одинарных кавычках, голые скаляры. Полный YAML
// doctor не нужен: ему надо прочесть mcpServers и disallowedTools так, как их
// пишет проекция iskronify и как их правит человек руками. Непрочитанное
// остаётся строкой — doctor говорит о том, что прочёл, а не угадывает.

export type YamlValue = string | YamlValue[] | { [key: string]: YamlValue } | null;

interface Line {
  indent: number;
  text: string;
}

/** Текст между первыми двумя строками `---`; нет фронтматтера — null. */
export function frontmatterText(file: string): string | null {
  const body = file.charCodeAt(0) === 0xfeff ? file.slice(1) : file; // BOM Блокнота Windows
  const lines = body.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  return end < 0 ? null : lines.slice(1, end).join("\n");
}

/** Скаляр или список в скобках — значение, стоящее в строке после `ключ:`. */
export function parseScalar(raw: string): YamlValue {
  const s = raw.trim();
  if (s.startsWith("[") && s.endsWith("]")) return splitFlow(s.slice(1, -1)).map(parseScalar);
  if (s.startsWith('"')) {
    try {
      return JSON.parse(s) as string;
    } catch {
      return s.slice(1, s.lastIndexOf('"') > 0 ? s.lastIndexOf('"') : undefined);
    }
  }
  if (s.startsWith("'"))
    return s.slice(1, s.lastIndexOf("'") > 0 ? s.lastIndexOf("'") : undefined).replace(/''/g, "'");
  return s.replace(/\s+#.*$/, "");
}

// Запятые списка в скобках — только вне кавычек и вложенных скобок.
function splitFlow(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      cur += c;
      if (c === "\\" && quote === '"') cur += body[++i] ?? "";
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

const KEY = /^("[^"]*"|'[^']*'|[^\s"'#-][^:]*?|-[^\s:][^:]*?)\s*:(?:\s+(.*))?$/;

const unquoteKey = (k: string): string =>
  (k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))
    ? k.slice(1, -1)
    : k;

/** Разобранный фронтматтер: карта верхнего уровня. */
export function parseFrontmatter(text: string): Record<string, YamlValue> {
  const lines: Line[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const indent = raw.length - raw.trimStart().length;
    lines.push({ indent, text: raw.trim() });
  }
  let i = 0;
  const isItem = (l: Line) => l.text === "-" || l.text.startsWith("- ");

  const block = (indent: number): YamlValue => {
    const first = lines[i];
    if (!first || first.indent < indent) return null;
    return isItem(first) ? list(first.indent) : map(first.indent);
  };

  const map = (indent: number): Record<string, YamlValue> => {
    const outMap: Record<string, YamlValue> = {};
    while (i < lines.length && lines[i].indent === indent && !isItem(lines[i])) {
      const m = KEY.exec(lines[i].text);
      i++;
      if (!m) continue;
      const key = unquoteKey(m[1].trim());
      if (m[2] !== undefined && m[2].trim() !== "") outMap[key] = parseScalar(m[2]);
      else {
        const next = lines[i];
        // `ключ:` и список под ним на том же отступе — законная форма YAML.
        outMap[key] =
          next && (next.indent > indent || (next.indent === indent && isItem(next)))
            ? block(next.indent)
            : null;
      }
    }
    return outMap;
  };

  const list = (indent: number): YamlValue[] => {
    const items: YamlValue[] = [];
    while (i < lines.length && lines[i].indent === indent && isItem(lines[i])) {
      const content = lines[i].text.slice(1).trimStart();
      if (!content) {
        i++;
        const next = lines[i];
        items.push(next && next.indent > indent ? block(next.indent) : null);
        continue;
      }
      if (KEY.test(content)) {
        // `- ключ: …` открывает карту, чьи прочие ключи стоят на отступе содержимого.
        lines[i] = { indent: indent + (lines[i].text.length - content.length), text: content };
        items.push(map(lines[i].indent));
        continue;
      }
      i++;
      items.push(parseScalar(content));
    }
    return items;
  };

  const top = block(0);
  return top && typeof top === "object" && !Array.isArray(top) ? top : {};
}
