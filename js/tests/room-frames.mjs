// Кадры комнаты в форме провода (граф nks-dev: #5893): конверт несёт
// event_kind "room.<род>" и строку журнала line; stack — только у said.
// Одно место для проб моста, сторожей, плагина OpenCode и расширения pi.
// Своё стояние проб — @tester:proba (так фейк NKS адресует место «proba»).

export const ME = "@tester:proba";
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
    fields: { evidence: [41], ends_at: "2026-09-23T10:05:00Z", may_object: [ME, "@aleksei:probe"] },
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

/** Род, которого словарь не знает. */
export const unknownKind = (entry_id = 61) =>
  roomFrame("weather", { entry_id, key: "weather", stack: "interrupt", body: "" });
