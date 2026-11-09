import { envName } from "./product.ts";
import { tool } from "./protocol.ts";

export const SPAWNED_FOR_ENV = envName("SPAWNED_FOR");
export const SPAWNED_FOR = {
  ru: {
    invalid: () =>
      "spawned_for: нужна полная пара {invite: положительное безопасное целое, room: UUID}; неверный JSON, повтор ключа или конфликт источников. Место не занимай.",
    echo: () =>
      "Register не подтвердил spawned_for той же парой. Подъём не подтверждён; работу не начинай.",
    initial: () =>
      "spawned_for: начальный ввод не подтверждён пустым прежним контекстом сессии. История непуста, недоступна или её форма неизвестна; место не занято.",
    kept: (place: string) =>
      `spawned_for: свежесть места ${place} этой попыткой не подтверждена; прежнее место не отзываю. Место могло остаться.`,
    connect: () =>
      `Прямой channel connect не принимает spawned_for. Используй ${tool("stand")}: connect без поля, затем register с парой. Место не занято.`,
    unbound: () =>
      "spawned_for: привязка взятого места к этой сессии ещё не восстановлена после проходящего отказа; мост повторит её перед следующим вызовом. Этот вызов не выполнен; другое место или вызов без пары её не заменяют.",
    schema: () =>
      "Основание запуска: номер приглашения внутри дела и UUID дела. Регистрация должна подтвердить ту же пару; отказ не обходится другим именем или take.",
    taken: (realm: string, room: string, invite: number) =>
      `Тебя взяли по зову ${invite} дела ${room} в графе ${realm}: регистрация подтвердила пару. До любой работы войди в это дело — ${tool("case")}(action="join", realm="${realm}", room="${room}") — и прочти его постановку; не вошёл — не работай, скажи почему.`,
  },
  en: {
    invalid: () =>
      "spawned_for requires {invite: positive safe integer, room: UUID}; invalid JSON, duplicate key or conflicting sources. Do not take a seat.",
    echo: () =>
      "Register did not confirm the same spawned_for pair. Launch is not confirmed; do not start work.",
    initial: () =>
      "spawned_for: an empty prior session context did not prove this is the initial prompt. History is nonempty, unavailable or unrecognized; no seat was taken.",
    kept: (place: string) =>
      `spawned_for: this attempt did not prove place ${place} fresh; the previous place is not revoked. The place may remain.`,
    connect: () =>
      `Raw channel connect does not accept spawned_for. Use ${tool("stand")}: connect without the field, then register with the pair. No seat was taken.`,
    unbound: () =>
      "spawned_for: the taken seat is not yet bound to this session again after a passing refusal; the bridge retries before the next call. This call did not run; another seat or a call without the pair does not replace it.",
    schema: () =>
      "Launch basis: the invitation number within its case and the case UUID. Register must confirm the same pair; do not bypass a refusal with another name or take.",
    taken: (realm: string, room: string, invite: number) =>
      `You were taken for invite ${invite} of case ${room} in graph ${realm}: register confirmed the pair. Before any work join that case — ${tool("case")}(action="join", realm="${realm}", room="${room}") — and read its assignment; not joined — do not work, say why.`,
  },
};

export const spawnedForSchema = (description: string) => ({
  type: "object",
  description,
  additionalProperties: false,
  properties: {
    invite: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    room: { type: "string", format: "uuid" },
  },
  required: ["invite", "room"],
});
