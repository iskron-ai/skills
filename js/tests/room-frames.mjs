// Кадры комнаты в форме провода (граф nks-dev: #5893): конверт несёт
// event_kind "room.<род>" и строку журнала line; stack — только у said.
// Одно место для проб моста, сторожей, плагина OpenCode и расширения pi.
// Своё стояние проб — @tester:proba (так фейк NKS адресует место «proba»).

export const ME = "@tester:proba";
/** id места проб у платформы: ключ invite и may_object по #5893 §4.2 несут id стояния. */
export const ME_ID = "5f0c1e2a-7b3d-4c9e-8a61-2d4b6f8e9a10";
export const ALEKSEI_ID = "9b2e4d6f-1a3c-4e5b-9d7f-0c2e4a6b8d1f";
export const ROOM = { id: "r-1", seq: 7, zachin: "Стенд", realm: "nks-dev", status: "open" };
export const ALEKSEI = {
  kind: "standing",
  standing: "@aleksei:probe",
  name: "Алексей",
  karta: { seq: 48, name: "Архитектор" },
};
export const PLATFORM = { kind: "platform" };

let n = 0;

/** Кадр комнаты рода `kind`; всё, что не названо, — как на проводе у обычной строки. */
export function roomFrame(
  kind,
  { entry_id, key = kind, fields = {}, author = ALEKSEI, stack, line = {}, body = "", status } = {},
) {
  const id = entry_id ?? 100 + ++n;
  return {
    type: "message",
    id: `room-msg-${id}`,
    room: { ...ROOM, status: status ?? ROOM.status },
    entry_id: id,
    event_kind: `room.${kind}`,
    ...(stack ? { stack, stack_by: "platform" } : {}),
    to_standing_id: ME_ID,
    to_standing: ME,
    line: { entry_id: id, at: "2026-09-23T10:00:00Z", kind, key, author, fields, ...line },
    body,
    provenance:
      author.kind === "platform"
        ? { auth: "platform", via: "room" }
        : {
            from_standing: author.standing,
            from_karta_seq: author.karta?.seq,
            auth: "pat",
            via: "room",
          },
  };
}

/** Предложение закрыть комнату — стопка defer, а прерывать обязано; моё стояние в may_object. */
export const closing = () =>
  roomFrame("closing", {
    entry_id: 50,
    key: "closing",
    stack: "defer",
    status: "closing",
    fields: { evidence: [41], ends_at: "2026-09-23T10:05:00Z", may_object: [ME_ID, ALEKSEI_ID] },
    body: "сделано, см. 41",
  });

/** Отчёт о ходе — в пачку. */
export const progress = (entry_id = 44) =>
  roomFrame("progress", {
    entry_id,
    key: "tests",
    line: { done: "пробы зелёные", verdict: "ok", note: "без сети" },
    body: "",
  });

/** Слово участника со стопкой. */
export const said = (stack, entry_id) =>
  roomFrame("said", { entry_id, key: "said", stack, body: `слово со стопкой ${stack}` });

/** Кадр комнаты прежней формы (без event_kind): верхний kind text|direct|digest|auto|… со своей стопкой, как на сегодняшнем бою. */
export const legacyRoom = (kind, stack, entry_id) => ({
  type: "message",
  id: `room-old-${entry_id}`,
  room: { id: "r-1", zachin: "Стенд", realm: "nks-dev", status: "open" },
  entry_id,
  kind,
  ...(stack ? { stack, stack_by: "platform" } : {}),
  body: `прежний род ${kind} со стопкой ${stack ?? "—"}`,
  provenance:
    kind === "text"
      ? { from_standing: "@aleksei:probe", from_karta_seq: 48, auth: "pat", via: "room" }
      : { auth: "platform", via: "room" },
});

/** Не кадр комнаты: прямое слово делателя. */
export const directWord = (id = "direct-1") => ({
  type: "message",
  id,
  body: "прямое слово соседа",
  provenance: { from_standing: "@alari:sosed", from_karta_seq: 48, auth: "oidc" },
});

/** Не кадр комнаты: событие графа posed_to (via=graph, тело-объект с event_id и своим event_kind). */
export const graphPosed = (id = "graph-1", event_id = 9001) => ({
  type: "message",
  id,
  content_type: "application/json",
  provenance: { via: "graph" },
  body: {
    realm_slug: "nks-dev",
    event_kind: "posed_to",
    vimarsha_seq: 5829,
    vimarsha_version: 1,
    event_id,
    reason: "posed_to",
  },
});

/** Род, которого словарь не знает. */
export const unknownKind = (entry_id = 61) =>
  roomFrame("weather", { entry_id, key: "weather", stack: "interrupt", body: "" });
