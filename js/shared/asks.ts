// Вопрос в деле — роды ask, answer, ack (граф nks-dev: контракт #6866, роды
// #6867, зов роли #6870; доля моста — #6868): кому вопрос, кому ответ и приём,
// и их слова. Правило стопки держит словарь родов (room-kinds.ts), слова — здесь.
import { classifyOrigin, type Frame } from "./channel.ts";
import { L, lang } from "./lang.ts";
import { addresseeOf, fill, mineOf, myRole, obj, type Rec, str } from "./room-fields.ts";

// ru:dict — русская таблица слов; английская рядом, язык выбирает вызывающий.
export const ASK_WORDS: Readonly<Record<string, string>> = {
  ask: "{author} спрашивает роль {to}{ to_place} [{key}]: «{done}»{; form}{; advice}",
  ask_place: "(место {place})",
  ask_yes_no: "ответ: да или нет (yes | no)",
  ask_free: "ответ своим текстом",
  ask_choice: "варианты: {options}",
  ask_advice: "рекомендация: {option}{ — why}",
  answer: "{author} отвечает на [{refers_to}]: {reply}",
  ack: "ответ [{refers_to}] принят{: reply} · {author}",
  // Снятие — progress роли спросившего на ключе вопроса с fields.withdraws.
  ask_withdrawn: "вопрос [{withdraws}] снят: [{key}] [{done}] = {verdict} · {author}",
  // Зов роли платформой по погасшему месту: cause — почему зовут.
  invite_ownerless: "платформа зовёт роль {who} в дело: место {standing} погасло, его строки ничьи",
  invite_answer_waiting:
    "платформа зовёт роль {who} в дело: ответ ждёт приёма, спросившее место {standing} ушло",
};
export const ASK_WORDS_EN: Readonly<Record<string, string>> = {
  ask: "{author} asks the role {to}{ to_place} [{key}]: “{done}”{; form}{; advice}",
  ask_place: "(seat {place})",
  ask_yes_no: "answer: yes or no (yes | no)",
  ask_free: "answer in your own words",
  ask_choice: "options: {options}",
  ask_advice: "recommended: {option}{ — why}",
  answer: "{author} answers [{refers_to}]: {reply}",
  ack: "answer [{refers_to}] accepted{: reply} · {author}",
  ask_withdrawn: "question [{withdraws}] withdrawn: [{key}] [{done}] = {verdict} · {author}",
  invite_ownerless:
    "the platform calls the role {who} to the case: the seat {standing} is gone, its lines are nobody's",
  invite_answer_waiting:
    "the platform calls the role {who} to the case: an answer awaits acceptance, the asking seat {standing} has left",
};

/** Роды вопроса — их слова и значения ведёт этот модуль. */
export const ASK_KINDS = new Set(["ask", "answer", "ack"]);

/** Слово таблицы вопроса по ключу; нет ключа — undefined. */
export const askWord = (key: string): string | undefined =>
  (lang() === "en" ? ASK_WORDS_EN : ASK_WORDS)[key];

const phrase = (key: string, values: Rec = {}): string => fill(askWord(key) ?? "", values);

/**
 * Адресат записи — fields.to (#6867, абзац ЧТЕНИЕ): у ask —
 * {karta {seq, name, realm}, standing? — место}; у answer и ack — само место
 * ждавшего {id, standing, name?, karta?}.
 */
const toOf = (fields: Rec): Rec => obj(fields.to);

/** Строку написало моё место — эхо своей записи. */
export const byMe = (frame: Rec): boolean => {
  const mine = mineOf(frame);
  const author = obj(obj(frame.line).author);
  return [str(author.id), str(author.standing)].some((a) => a && mine.includes(a));
};

/**
 * Строка вопроса от места человека (окно, бот): её раскладывает адресованность,
 * не правило слова человека «всегда целиком» (#6867). Одно определение — пачке
 * сторожей моста (roomstack.ts) и плагину OpenCode.
 */
export const askFromPerson = (frame: Rec): boolean =>
  ASK_KINDS.has(str(obj(frame.line).kind)) && classifyOrigin(frame as Frame) === "human";

/** Аккаунт места по адресу @handle:name; без адреса — пусто. */
const handleOf = (address: string): string => /^@([^:]+):/.exec(address)?.[1] ?? "";

/**
 * Вопрос мне: to.standing — моё место; иначе to.karta — моя роль (сверка как у
 * приглашения роли), а названное место, если есть, — того же аккаунта: на вопрос
 * месту отвечают места его аккаунта в этой роли (#6867), чужим он не адресован.
 */
export function askedMine(frame: Rec, fields: Rec): boolean {
  const mine = mineOf(frame);
  // Эхо своего вопроса — не вопрос мне, даже если спрошена моя же роль.
  if (byMe(frame)) return false;
  const to = toOf(fields);
  const place = addresseeOf(to.standing);
  if (place?.addr.some((a) => mine.includes(a))) return true;
  if (!myRole(frame, { karta: to.karta })) return false;
  if (!place) return true;
  const theirs = handleOf(str(obj(to.standing).standing) || str(to.standing));
  return !!theirs && theirs === handleOf(str(frame.to_standing));
}

/** Ответ или приём мне: адресат кадра (addressee, иначе fields.to) — моё место, и он из дела не вышел. */
export function addressedMine(frame: Rec): boolean {
  if (frame.addressee_left === true) return false;
  const to = addresseeOf(frame.addressee) ?? addresseeOf(toOf(obj(obj(frame.line).fields)));
  const mine = mineOf(frame);
  return !!to && to.addr.some((a) => mine.includes(a));
}

const quote = (s: string): string => (s ? L(`«${s}»`, `“${s}”`) : "");

function formOf(fields: Rec): string {
  const form = str(fields.form);
  if (form === "yes_no") return phrase("ask_yes_no");
  if (form === "free") return phrase("ask_free");
  if (form !== "choice" || !Array.isArray(fields.options)) return "";
  const options = fields.options
    .map((o) => {
      const x = obj(o);
      const ctx = str(x.context);
      return `${str(x.id)} ${quote(str(x.label))}${ctx ? ` (${ctx})` : ""}`;
    })
    .join(", ");
  return phrase("ask_choice", { options });
}

/** Значения слов рода вопроса: адресат, форма, рекомендация — у ask; ответ — у answer и ack. */
export function askValues(kind: string, line: Rec, fields: Rec): Rec {
  if (kind !== "ask")
    return { reply: [str(fields.choice), quote(str(line.done))].filter(Boolean).join("; ") };
  const to = toOf(fields);
  const k = obj(to.karta);
  const place = addresseeOf(to.standing)?.label ?? "";
  const rec = obj(fields.recommendation);
  return {
    to: str(k.name) || (str(k.seq) ? `#${str(k.seq)}` : ""),
    to_place: place ? phrase("ask_place", { place }) : "",
    form: formOf(fields),
    advice:
      str(rec.option) || str(rec.why)
        ? phrase("ask_advice", { option: str(rec.option) || "—", why: rec.why })
        : "",
  };
}
