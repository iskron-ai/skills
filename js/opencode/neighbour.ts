// Рядом с плагином может стоять запись mcp того же Искрона: её тулы OpenCode
// именует <сервер>_<тул>, и в каталоге сессии они видны как *_iskron_*. Мост у
// неё общий для сессий сервиса, поэтому запись дочерней сессии может уйти под
// подписью соседней (граф nks-dev: #5553, #5560). Каталог — единственное место,
// где это ВИДНО изнутри сессии, а не выводится из конфига на диске.
interface Listing {
  list(): readonly unknown[];
}

export function warnOnNeighbour(
  editor: Listing,
  say: (text: string, level: "info" | "warning") => void,
): void {
  const neighbours = editor
    .list()
    .map((t) =>
      String((t as { name?: unknown; id?: unknown }).name ?? (t as { id?: unknown }).id ?? ""),
    )
    .filter((name) => /_iskron_[a-z_]+$/.test(name));
  if (!neighbours.length) return;
  say(
    `Искрон: рядом стоит вторая запись того же графа — тулы ${neighbours.slice(0, 3).join(", ")}${neighbours.length > 3 ? " и другие" : ""}. ` +
      "Её мост общий для сессий сервиса, и запись может уйти под подписью соседней сессии: зови тулы iskron_* без префикса, а запись mcp убери из конфига OpenCode.",
    "warning",
  );
}
