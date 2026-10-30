import { SUB_TOOL, roleOf, toolParts, actualModels } from "./stand-recall-evidence.mjs";

export function intakePrompts(scene) {
  const full = `Я владелец продукта. Внеси в граф следующий полный рассказ о повторяемом импорте каталогов; это описание работы, не мои решения о будущем выпуске.
1. Поставщик подаёт файл каталога с позициями, ценами и остатками в загрузку импорта.
2. Разработчик импорта проверяет формат и обязательные поля полученного файла.
3. Разработчик импорта отделяет некорректные строки и составляет отчёт об ошибках проверки.
4. Разработчик импорта превращает корректные строки в задания и передаёт их фоновой очереди.
5. Воркер очереди забирает задания и обрабатывает позиции каталога.
6. Воркер очереди публикует результат обработки: принятые позиции и ошибки исполнения.
7. Разработчик импорта потребляет результат, сверяет его с поданным каталогом и выдаёт поставщику итог импорта.
Здесь три делателя: поставщик, разработчик импорта (проверка, постановка и потребление результата), воркер очереди (обработка и публикация результата). Используй intake и ingester там, где это предписано навыком. Сначала покажи набросок разнесения рассказа. После впуска сам прочти полученные узлы и сравни их с исходным рассказом. Работай только в контуре импорта #${scene.own}; внешний контур очередей #${scene.foreign} не меняй.`;
  return { f: [full], g: ["Я владелец продукта. Запиши через intake короткое описание одного повторяемого действия: разработчик импорта проверяет полученный файл каталога и выдаёт отчёт об ошибках формата."] };
}

// Mechanical rejection only. Passing these necessary checks is not semantic acceptance.
export function intakeEvidence(key, tree, fullText, { calls = [], scene, fact } = {}) {
  const launches = tree.sessions.flatMap((s) => toolParts(s.messages).filter((p) => SUB_TOOL.test(p.name))
    .map((p) => ({ sessionID: s.sessionID, role: roleOf(p), input: p.state?.input, metadata: p.state?.metadata })));
  const models = tree.sessions.map((s) => ({ sessionID: s.sessionID, actual: actualModels(s.messages) }));
  const errors = [...tree.blockers];
  if (models.some((s) => !s.actual.length)) errors.push("actual model evidence missing");
  const ingesters = tree.sessions.filter((s) => s.parentID && s.role === "ingester");
  if (key === "g" && launches.some((p) => p.role === "ingester")) errors.push("short intake launched ingester");
  if (key === "f") {
    if (!ingesters.length) errors.push("no observed ingester child");
    const steps = fullText.split("\n").filter((line) => /^[1-7]\. /.test(line));
    if (!launches.some((p) => p.role === "ingester" && steps.every((step) => JSON.stringify(p.input).includes(JSON.stringify(step).slice(1, -1)))))
      errors.push("ingester did not receive all seven source steps");
  }
  const created = calls.filter((c) => !c.error && /^iskron_add_/.test(c.name)).map((c) => ({
    by: c.by, tool: c.name, id: c.text.match(/\(#(\d+)[,)]/)?.[1], args: c.args,
  }));
  const node = (v) => String(v ?? "").replace(/^#/, "").trim();
  const batches = calls.filter((c) => c.name === "iskron_batch");
  const ownReads = created.filter((c) => c.id && calls.some((r) => !r.error && r.by === "agent" && r.name === "iskron_look" && node(r.args.node_id) === c.id));
  let foreignMutations = [];
  if (key === "f" && scene) {
    const foreignIDs = [scene.foreign, scene.steward, fact];
    foreignMutations = calls.filter((c) => /^(iskron_update|iskron_delete_node|iskron_arrow)$/.test(c.name)
      && [c.args.node_id, c.args.source, c.args.target].some((id) => foreignIDs.includes(node(id))));
    foreignMutations.push(...calls.filter((c) => /^iskron_add_/.test(c.name) && (c.args.arrows ?? [])
      .some((a) => foreignIDs.includes(node(a.target)) && ["contains", "context", "steward"].includes(a.arrow_type))));
    if (foreignMutations.length) errors.push("foreign contour mutation");
    if (created.some((c) => c.tool === "iskron_add_kriya" && (c.args.arrows ?? [])
      .some((a) => a.arrow_type === "actor" && node(a.target) === scene.human))) errors.push("owner encoded as actor");
    const childCreates = created.filter((c) => c.by === "sub:ingester");
    if (!batches.length && (childCreates.filter((c) => c.tool === "iskron_add_kriya").length < 2
      || childCreates.filter((c) => c.tool === "iskron_add_phenomenon").length < 2 || !ownReads.length))
      errors.push("missing multiple child transitions/phenomena or root reads");
  }
  return { errors, launches, models, created, batches, ownReads, foreignMutations,
    review: "Inspect sketch-before-launch, actual intake, all seven steps/three actors for f, produced nodes and arrows, root reads/comparison and absence of foreign writes (including batches). No automated semantic PASS." };
}
