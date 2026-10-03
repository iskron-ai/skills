// Роль владельца (主 svatantra) агент без слова человека не занимает (граф nks-dev:
// #6550, правило 2). Род роли решает сервер: iskron_search с фильтром
// manifested_as="svatantra" отдаёт роли владельца графа, и мост берёт из строк только
// номера «(#N,» — не прозу рода, которая сменится с локалью. Машинного поля рода в
// ответе look/me нет (риск api #6631); страница неполна — откат на шапку iskron_look.
// Слово человека — настройка его окружения: ISKRON_BRIDGE_OWNER_ROLE=1 у моста
// харнеса, не аргумент вызова агента. «me» и «realm-owner» — роль самого человека:
// та же граница. Род не прочитался — отказ с причиной, не обход.
import { L } from "../shared/lang.ts";
import { envOf, scoped } from "../shared/scope.ts";
import { callTool, short } from "./call.ts";
import { normKarta } from "./names.ts";

export const OWNER_ENV = "ISKRON_BRIDGE_OWNER_ROLE";
const HUMAN = new Set(["me", "realm-owner"]);
/** Тип роли по графу и номеру — у сессии: роль свой тип не меняет за её жизнь. */
const known = scoped(() => new Map<string, boolean>());

const word = (what: string) =>
  L(
    `Отказано (мост): ${what} — роль владельца (主). Агент не занимает её без слова человека; ` +
      `слово человека — настройка ${OWNER_ENV}=1 в окружении моста, которую ставит он сам. ` +
      "Встань своей ролью (karta) — той, что назвал тебе человек или AGENTS.md как роль агента.",
    `Refused (bridge): ${what} is the owner's role (主). An agent does not take it without the human's word; ` +
      `the human's word is the setting ${OWNER_ENV}=1 in the bridge's environment, set by the human. ` +
      "Stand in your own role (karta) — the one the human or AGENTS.md named as the agent's.",
  );

/** Слово отказа, когда karta — роль владельца, а настройки человека нет; иначе null. */
export async function ownerRefusal(realm: unknown, karta: unknown): Promise<string | null> {
  if (envOf(OWNER_ENV)?.trim() === "1") return null;
  const k = normKarta(karta);
  if (!k || k === "agent") return null;
  if (HUMAN.has(k))
    return word(L(`karta="${k}" — роль самого человека`, `karta="${k}" is the human's own role`));
  if (!/^\d+$/.test(k)) return null; // не номер — сервер откажет сам
  const key = `${String(realm ?? "")}|${k}`;
  let owner = known.get(key);
  if (owner === undefined) {
    const r = await ownersOf(realm, k);
    if (typeof r === "string")
      return L(
        `Отказано (мост): тип роли #${k} не прочитался (${short(r, 160)}) — роль владельца без проверки не занимается; повтори.`,
        `Refused (bridge): the type of role #${k} could not be read (${short(r, 160)}) — the owner's role is not taken unchecked; retry.`,
      );
    owner = r;
    known.set(key, owner);
  }
  return owner ? word(`karta=#${k}`) : null;
}

/** Роль #k — владельца? Сервер фильтром рода; неполная страница — шапка узла. Строка — причина сбоя. */
async function ownersOf(realm: unknown, k: string): Promise<boolean | string> {
  const s = await callTool("iskron_search", {
    realm,
    q: "",
    node_type: "karta",
    manifested_as: "svatantra",
    limit: 100,
    include_description: false,
  });
  if (!s.isError && !/НЕ показано|not shown/i.test(s.text))
    return [...s.text.matchAll(/\(#(\d+)[,)]/g)].some((m) => m[1] === k);
  const r = await callTool("iskron_look", { realm, node_id: k });
  if (r.isError) return r.text;
  return /\(#\d+,\s*karta\s+主/.test(r.text) || /Проявлен как:\s*主/.test(r.text);
}
