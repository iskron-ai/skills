// Запись mcp Искрона рядом с плагином OpenCode: её тулы едут namespaced, а мост
// у неё общий для сессий сервиса — запись дочерней сессии может уйти под
// подписью соседней (граф nks-dev: #5553, класс #4283). Где лежит конфиг и как
// он читается — поверхность #5559, наблюдённая на opencode 2.0.9.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { isProductionServer } from "../bridge/config.ts";

export function openCodeMcpEntries(out: (s: string) => void): void {
  const dirFiles = (d: string): string[] => [
    join(d, "opencode.json"),
    join(d, "opencode.jsonc"),
    join(d, ".opencode", "opencode.json"),
    join(d, ".opencode", "opencode.jsonc"),
  ];
  const upwards: string[] = [];
  // Проектный слой выключается переменной — тогда файлы дерева OpenCode не читает,
  // и советовать по ним значит указывать на конфиг, которым он не пользуется.
  if (!process.env.OPENCODE_CONFIG_PROJECT_DISABLE)
    for (let d = process.cwd(); ;) {
      upwards.push(...dirFiles(d));
      const up = dirname(d);
      if (up === d) break;
      d = up;
    }
  // Переменные названы бинарём 2.0.9, но влияния на `opencode mcp list` у них не
  // наблюдалось (#5559): читаем их на стороне безопасности — лишняя строка дешевле
  // молчания о записи, которую сервис всё же возьмёт.
  const files = [
    ...(process.env.OPENCODE_CONFIG ? [process.env.OPENCODE_CONFIG] : []),
    // Относится ли каталог из переменной к проектному слою, выключатель которого
    // читается ниже, не наблюдалось (#5559): читаем его в любом случае.
    ...(process.env.OPENCODE_CONFIG_DIR ? dirFiles(process.env.OPENCODE_CONFIG_DIR) : []),
    ...dirFiles(join(homedir(), ".config", "opencode")),
    ...upwards,
  ];
  // Своя запись двух родов, и цена у них разная: локальный мост той же поставки
  // (тулы namespaced, мост общий для сессий сервиса — чужая подпись) и нативная
  // http-запись на адрес Искрона (законный запасной путь, стояния у неё нет
  // вовсе). Чужой сервер, лежащий в каталоге со словом iskron в пути, — не наш.
  const kindOf = (v: unknown): "bridge" | "http" | null => {
    const e = (v ?? {}) as { command?: string | string[]; args?: string[]; url?: string };
    const parts = [
      ...(Array.isArray(e.command) ? e.command : e.command ? [e.command] : []),
      ...(e.args ?? []),
    ];
    if (parts.some((p) => /(^|[\\/])iskron[^\\/]*\.mjs$|iskron-bridge/.test(String(p))))
      return "bridge";
    // Продовых адреса ровно два — русский и английский (#5040), и решает их общий
    // предикат: прочие хосты тех же доменов поставке не принадлежат.
    if (e.url && isProductionServer(e.url)) return "http";
    return null;
  };
  // .jsonc существует ради комментариев и висячих запятых: JSON.parse падает на
  // тех и других. Два прохода, и оба щадят строковый литерал: сперва уходят
  // комментарии, затем запятая перед закрывающей скобкой — одним проходом
  // запятая, отделённая от скобки комментарием, осталась бы на месте.
  const parse = (text: string): { mcp?: Record<string, unknown> } => {
    const STRING = '"(?:[^"\\\\]|\\\\.)*"';
    const noComments = text.replace(
      new RegExp(`${STRING}|/\\*[\\s\\S]*?\\*/|//[^\\n]*`, "g"),
      (m) => (m.startsWith('"') ? m : ""),
    );
    const noTrailing = noComments.replace(
      new RegExp(`${STRING}|,(\\s*[}\\]])`, "g"),
      (m, tail: string | undefined) => (m.startsWith('"') ? m : (tail ?? "")),
    );
    return JSON.parse(noTrailing) as { mcp?: Record<string, unknown> };
  };
  // Путь, по которому запись признана мостом, — чтобы читатель сверил сам, а не
  // верил слову: совпадение идёт по имени файла и бывает случайным.
  const bridgePath = (v: unknown): string => {
    const e = (v ?? {}) as { command?: string | string[]; args?: string[] };
    const parts = [
      ...(Array.isArray(e.command) ? e.command : e.command ? [e.command] : []),
      ...(e.args ?? []),
    ].map(String);
    return (
      parts.find((p) => /(^|[\\/])iskron[^\\/]*\.mjs$|iskron-bridge/.test(p)) ?? parts.join(" ")
    );
  };
  let unreadable = 0;
  const sources: [string, string][] = [];
  for (const f of new Set(files)) {
    if (!existsSync(f)) continue;
    // Нечитаемый файл по пути вверх (права, каталог вместо файла) не смеет
    // ронять весь отчёт: остальные его строки — такие же факты.
    try {
      sources.push([f, readFileSync(f, "utf8")]);
    } catch {
      unreadable++;
      out(`OpenCode: ${f} не читается`);
    }
  }
  if (process.env.OPENCODE_CONFIG_CONTENT)
    sources.unshift(["OPENCODE_CONFIG_CONTENT", process.env.OPENCODE_CONFIG_CONTENT]);
  let found = 0;
  for (const [file, text] of sources) {
    try {
      const cfg = parse(text);
      for (const [name, v] of Object.entries(cfg.mcp ?? {})) {
        const kind = kindOf(v);
        if (!kind) continue;
        found++;
        if ((v as { enabled?: boolean }).enabled === false) {
          out(`OpenCode: запись mcp «${name}» в ${file} ведёт Искрон, но выключена — не в игре`);
          continue;
        }
        out(
          kind === "bridge"
            ? `OpenCode: запись mcp «${name}» в ${file} зовёт ${bridgePath(v)} — похоже на мост поставки. Если это он, её тулы namespaced, а мост общий для сессий сервиса: запись может уйти под подписью соседней сессии. Тогда убери её из этого файла руками: у opencode mcp есть list, add, auth, logout — команды remove нет. Поверхность поставки это плагин`
            : `OpenCode: запись mcp «${name}» в ${file} ведёт Искрон напрямую по http — её тулы namespaced, и стояния канала у неё нет; это запасной путь, и он законен там, где мост не поднять`,
        );
      }
    } catch {
      unreadable++;
      out(`OpenCode: ${file} не читается`);
    }
  }
  // Чистого отчёта без названного охвата не бывает: doctor идёт вверх от СВОЕГО
  // каталога, а зовут его обычно из дома — тогда запись в дереве проекта он не
  // видел вовсе, и молчание прочли бы как «записи нет» (граф nks-dev: #4279).
  if (!found)
    out(
      `OpenCode: записей mcp Искрона не нашёл${unreadable ? ` в том, что прочёл (${unreadable} файл(а) не разобрались — смотри строки выше)` : ""} — смотрел вверх от ${process.cwd()}, глобальный слой и переменные; запись в другом дереве этим не проверена, позови doctor из каталога проекта`,
    );
}
