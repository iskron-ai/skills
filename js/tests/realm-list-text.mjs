// Exact framing/footer from the anonymised production sample realm-list-live.txt.
export function realmListText(realms, archived = 3) {
  const lines = [
    `Доступные графы (${realms.length}) — адресуй их как @owner/slug или rN; обе формы показаны ниже:`,
  ];
  const owners = new Map();
  for (const r of realms) {
    const owner = r.canon.split("/")[0];
    if (!owners.has(owner)) owners.set(owner, []);
    owners.get(owner).push(r);
  }
  for (const [owner, rows] of owners) {
    lines.push(
      "",
      `▸ ${owner} (${rows[0].ownerKind === "organization" ? "организация" : "пользователь"})`,
    );
    for (const r of rows)
      lines.push(
        `    ${r.canon}  ${r.short}  ${r.name ?? r.canon.split("/")[1]} · ${r.date ?? "2026-09-23"}`,
      );
  }
  lines.push("", "Дата в конце строки — последнее изменение в этом графе.");
  if (archived !== null)
    lines.push("", `🗄 Архивных графов скрыто: ${archived} — include_archived=true покажет и их.`);
  lines.push(
    "",
    "Передавай в 'realm' любой из двух адресов: полный '@owner/slug' или короткий 'rN'. Обе колонки можно копировать как есть.",
  );
  return lines.join("\n");
}
