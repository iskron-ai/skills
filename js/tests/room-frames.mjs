// Кадры комнаты в форме провода (граф nks-dev: #5893): конверт несёт
// event_kind "room.<род>" и строку журнала line; stack — только у said и body (метка слова).
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
  {
    entry_id,
    key = kind,
    fields = {},
    author = ALEKSEI,
    stack,
    line = {},
    body = "",
    status,
    envelope = {},
  } = {},
) {
  const id = entry_id ?? 100 + ++n;
  return {
    ...envelope,
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
    // Форма боя (api 0.88.0, наблюдено живым прогоном): объекты мест, не голые id.
    fields: {
      evidence: [41],
      ends_at: "2026-09-23T10:05:00Z",
      may_object: [
        { id: ME_ID, standing: ME, name: "proba", karta: { seq: 3, name: "Прораб" } },
        { id: ALEKSEI_ID, standing: ALEKSEI.standing, name: "Алексей", karta: ALEKSEI.karta },
      ],
    },
    body: "сделано, см. 41",
  });

/** Роль места проб и граф, которые кадр несёт в конверте (karta_seq, realm). */
export const MY_KARTA = 4;
export const MY_REALM = "@alari/paper-demo";

/**
 * Приглашение РОЛИ (api 0.89.6, форма наблюдена на бою): ключ — id узла роли,
 * поля строки — karta {id, name, realm, seq}; кадр доходит живому месту роли и
 * несёт его karta_seq. seq = MY_KARTA — моя роль, иначе чужая.
 */
export const roleInvite = (entry_id, seq = MY_KARTA) =>
  roomFrame("invite", {
    entry_id,
    key: "invite:5744a929-982c-4efe-88ff-480ab66f61b8",
    fields: {
      karta: {
        id: "5744a929-982c-4efe-88ff-480ab66f61b8",
        name: "🚚 Поставщик плитки",
        realm: MY_REALM,
        seq,
      },
    },
    envelope: { realm: MY_REALM, karta_seq: MY_KARTA },
  });

/** Отзыв приглашения моему месту — в пачку. */
export const withdraw = (entry_id) =>
  roomFrame("withdraw", {
    entry_id,
    key: `invite:${ME_ID}`,
    envelope: { realm: MY_REALM, karta_seq: MY_KARTA },
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

/** Чужое место — адресат слова, обращённого не мне. */
export const BORIS = "@boris:probe";

/**
 * Адресное слово (#6081; api 0.91.3, форма наблюдена на бою): addressee —
 * верхним полем конверта, строкой-адресом места; объект места — тоже.
 */
export const addressed = (entry_id, addressee = BORIS, stack = "interrupt") =>
  roomFrame("said", {
    entry_id,
    key: "said",
    stack,
    envelope: { addressee },
    body: `тайное слово ${entry_id}`,
  });

// ── Слово в две фазы (api 0.91.x; #5893 §4.5b, #5953) ──
// said в полёте: body_pending: true — верхним полем КОНВЕРТА (#5893 §4.5b; api
// подтвердил по коду провода), текста нет. Стопка interrupt: такой said не
// прерывает и со своей стопкой.
export const saidInFlight = (entry_id = 54) =>
  roomFrame("said", {
    entry_id,
    key: "said",
    stack: "interrupt",
    fields: { kind: "text" },
    envelope: { body_pending: true },
    body: "",
  });

/** Автор слова — место-объект in_reply_to_from конверта (#5893 §4.6). */
const WORD_FROM = { id: ALEKSEI_ID, standing: ALEKSEI.standing, name: "Алексей" };

// body: форма наблюдена на сокете места (локальный api 0.90.1-8, 2026-09-25):
// in_reply_to, kind, line (запись body: refers_to, fields, done), word, body,
// stack. В наблюдении срезаны provenance и room — их кладёт roomFrame, как и
// at и author строки (§4.1); ключа у body нет. in_reply_to_from в срезе не
// виден — он по §4.5b/§4.6 и слову api по коду провода.
const bodyLine = (refers_to, fields, done) => ({
  key: undefined,
  refers_to,
  fields,
  ...(done === undefined ? {} : { done }),
});
const wordOf = (refers_to, text) => ({
  entry_id: refers_to,
  line: text
    ? { entry_id: refers_to, kind: "said", fields: { kind: "text" }, done: text }
    : {
        entry_id: refers_to,
        kind: "said",
        fields: { aborted: true, kind: "text" },
        verdict: "bad",
      },
});

/** Текст слова refers_to второй фазой; стопка — метка слова. */
export const body = (entry_id = 55, refers_to = 54, text = "текст второй фазы") =>
  roomFrame("body", {
    entry_id,
    stack: "defer",
    line: bodyLine(refers_to, {}, text),
    envelope: {
      in_reply_to: refers_to,
      in_reply_to_from: WORD_FROM,
      kind: "body",
      word: wordOf(refers_to, text),
    },
    body: text,
  });

/** Обрыв слова автором: наблюдён без стопки и с пустым телом. */
export const bodyAborted = (entry_id = 57, refers_to = 56) =>
  roomFrame("body", {
    entry_id,
    line: bodyLine(refers_to, { aborted: true }),
    envelope: {
      in_reply_to: refers_to,
      in_reply_to_from: WORD_FROM,
      kind: "body",
      word: wordOf(refers_to),
    },
    body: "",
  });

/** Обрыв платформой по сроку: вживую не наблюдён — по §4.5b автор записи платформа, стопка defer. */
export const bodyLapsed = (entry_id = 59, refers_to = 58) =>
  roomFrame("body", {
    entry_id,
    author: PLATFORM,
    stack: "defer",
    line: bodyLine(refers_to, { aborted: true }),
    envelope: {
      in_reply_to: refers_to,
      in_reply_to_from: WORD_FROM,
      kind: "body",
      word: wordOf(refers_to),
    },
    body: "",
  });

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

/** Дочернее дело в полях link и auto — {id, seq, zachin} (#5893 §4.3a). */
export const CHILD = { id: "r-12", seq: 12, zachin: "Плитка" };

/** Запись платформы родителю о дочернем деле (#5893 §4.2): auto с code, ключ link:<дочернее>. */
export const auto = (code, entry_id = 80) =>
  roomFrame("auto", {
    entry_id,
    key: `link:${CHILD.id}`,
    author: PLATFORM,
    fields: { code, room: CHILD, entry: 900 },
  });

/** Связь дел (#4915): link {room, rel}, автор — открывший. */
export const link = (rel, entry_id = 81) =>
  roomFrame("link", { entry_id, key: `link:${CHILD.id}`, fields: { room: CHILD, rel } });

/** Место, ушедшее из дела и вошедшее в него, — в полях строки (api 0.89.6). */
export const MEMBER_ID = "3c7a9e1b-5d2f-4a8c-b6e0-1f3d5a7c9e2b";
export const MEMBER = {
  id: MEMBER_ID,
  karta: { name: "Архитектор", seq: 48 },
  name: "fluence.nks-agents.rooms",
  standing: "@aleksei:fluence.nks-agents.rooms",
};

/** Уход по истечении (форма боя 2026-09-25, api 0.89.6): автор — платформа, ушедший — в fields.standing. */
export const leftExpired = (entry_id = 84) =>
  roomFrame("left", {
    entry_id,
    key: `member:${MEMBER_ID}`,
    author: PLATFORM,
    fields: { reason: "expired", standing: MEMBER },
  });

/** Вход места в дело с тем же полем standing, что у ухода. */
export const joinedMember = (entry_id = 85) =>
  roomFrame("joined", { entry_id, key: `member:${MEMBER_ID}`, fields: { standing: MEMBER } });

/** Узел в деле — {seq, name, realm}. */
export const NODE = { seq: 4057, name: "js-bundle", realm: "@nks/nks-dev" };

/** Узел в деле без op и reasoning — сегодняшняя форма боя. */
export const nodeBound = (entry_id = 86) =>
  roomFrame("node", { entry_id, key: `node:${NODE.seq}`, fields: { node: NODE } });

/**
 * Узел с op — форма по слову api (ветка api #546), не по бою: reasoning дельты —
 * ТЕЛО записи (line.done и body кадра), в fields рядом с node только op.
 */
export const nodeOp = (op, entry_id = 87) =>
  roomFrame("node", {
    entry_id,
    key: `node:${NODE.seq}`,
    fields: { node: NODE, op },
    line: { done: `причина ${op}` },
    body: `причина ${op}`,
  });

/** Род, которого словарь не знает. */
export const unknownKind = (entry_id = 61) =>
  roomFrame("weather", { entry_id, key: "weather", stack: "interrupt", body: "" });
