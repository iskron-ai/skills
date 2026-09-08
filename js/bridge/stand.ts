// iskron_stand — тул моста, занимающий стояние одним вызовом (граф nks-dev:
// феномен #4511, вопрошание #4508, превращение #4504). На сервер он не
// уходит: мост исполняет его сам теми же вызовами, которыми агент прежде шёл
// по скиллу standing, — доска, выведенное имя, connect и register (либо один
// register, когда сокет уже держит этот мост: живое стояние не ротируется без
// причины), хук инбокса роли, стук в комнату по полному адресу с провода
// (один раз за сессию: второй join — повтор, не разговор), занятость. Ответ
// один: имя, команда сторожа, ожидавшие кадры, хук, расписка стука.
// Отсутствие тула в сессии — тулы идут мимо моста либо мост старой сборки.
import { execFileSync } from "node:child_process";
import { hostname } from "node:os";
import { basename } from "node:path";

import { CFG } from "./config.ts";
import {
  absorbChannelReply,
  awaitHello,
  holdsStanding,
  listenBlock,
  publishStatus,
  releaseStanding,
} from "./hold.ts";
import { noteStanding, replyText } from "./standing.ts";
import { post } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";
import { readLatest, staleNotice } from "./update.ts";

export const STAND_TOOL = {
  name: "iskron_stand",
  description:
    "[мост] Занять стояние одним вызовом: мост читает доску, выводит имя (машина.репо.ветка), занимает место " +
    "(connect и register; только register, если сокет уже держит этот мост), взводит хук инбокса роли своим входящим " +
    "адресом, при room шлёт кадр join стоянию комнаты по полному адресу с провода (повтор — только repeat_knock=true, один раз, не раньше чем через 2 минуты) и возвращает " +
    "имя, команду сторожа, число ожидавших кадров, состояние хука и расписку стука. Дальше — запустить сторожа " +
    "командой из ответа и ждать. Тул исполняет мост; нет его в сессии — тулы идут мимо моста либо мост старой сборки (doctor скажет), стой по скиллу standing.",
  inputSchema: {
    type: "object",
    properties: {
      realm: { type: "string", description: "Адрес графа: @owner/slug или rN." },
      karta: { type: "string", description: "Роль агента (#N из AGENTS.md или строки запуска)." },
      name: {
        type: "string",
        description: "Своя половина имени стояния; без неё выводится машина.репо.ветка.",
      },
      room: {
        type: "string",
        description:
          "Полный адрес стояния комнаты @handle:name из строки приглашения; мост шлёт ему join.",
      },
      mute_siblings: { type: "boolean", description: "Не слышать эхо других стояний той же роли." },
      take: {
        type: "boolean",
        description:
          "Забрать сокет места, которое слушает другой мост этой машины (обычно прежняя сессия той же рабочей копии): без take такое место только регистрируется, слух остаётся у держателя.",
      },
      room_karta: {
        type: "string",
        description:
          "Роль, чьё стояние — комната (#N), если комнаты нет на доске; обычно роль человека, приславшего приглашение.",
      },
      repeat_knock: {
        type: "boolean",
        description:
          "Осознанный повтор стука в ту же комнату: разрешён один раз и не раньше чем через 2 минуты после первого; без него повторный вызов второго join не шлёт.",
      },
      status: { type: "string", description: "Первая строка занятости (до 64 символов)." },
    },
    required: ["realm", "karta"],
  },
};

export const isStandCall = (msg: JsonRpcMessage): boolean =>
  msg?.method === "tools/call" && msg?.params?.name === "iskron_stand";

const sanitize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 32);

const git = (args: string[]): string => {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
};

/** машина.репо.ветка — из того, что свежая сессия восстановит без памяти. */
export function deriveName(): string {
  const host = hostname().split(".")[0];
  const top = git(["rev-parse", "--show-toplevel"]);
  const repo = basename(top || process.cwd());
  const branch = top ? git(["rev-parse", "--abbrev-ref", "HEAD"]) : "";
  return [host, repo, branch].map(sanitize).filter(Boolean).join(".");
}

interface BoardEntry {
  karta: string;
  address: string;
  rest: string;
  incoming: string | null;
}

/** Строки доски: `#N … · @handle:name — …`, за ними `📥 https://…`. */
export function parseBoard(text: string): BoardEntry[] {
  const out: BoardEntry[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*#(\d+)\s.*?·\s(@\S+)\s—\s(.*)$/.exec(line);
    if (m) {
      out.push({ karta: m[1], address: m[2], rest: m[3], incoming: null });
      continue;
    }
    const inc = /📥\s*(https?:\/\/\S+)/.exec(line);
    if (inc && out.length) out[out.length - 1].incoming = inc[1];
  }
  return out;
}

let seq = 0;
/**
 * Стуки по комнатам — когда и сколько, ключ (граф, роль, имя, комната). Правило
 * ожидания — #4342. Запись живёт в процессе моста и умирает с ним; новый цикл
 * входа (connect — свежий сокет) сбрасывает счёт по этому месту: предел повторов
 * — на один заход, не пожизненный запрет.
 */
const knocks = new Map<string, { at: number; count: number }>();
// Окно повтора — 2 минуты по #4342; переменная — шов для проб, не ручка человека.
const KNOCK_REPEAT_AFTER_MS = Number(process.env.ISKRON_STAND_KNOCK_REPEAT_MS) || 120_000;
const KNOCK_LIMIT = 2;

interface Answer {
  text: string;
  isError: boolean;
}

async function call(name: string, args: Record<string, unknown>): Promise<Answer> {
  const id = `iskron-bridge-stand-${++seq}`;
  const msg: JsonRpcMessage = {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  };
  let reply: JsonRpcMessage | null = null;
  await post(msg, (m) => {
    if (m.id === id) reply = m;
  });
  let got = reply as JsonRpcMessage | null;
  if (!got) return { text: "ответа нет", isError: true };
  if (name === "iskron_channel") {
    if (args.action === "register") noteStanding(msg, got);
    if (args.action === "connect") got = absorbChannelReply(msg, got);
  }
  return { text: replyText(got), isError: !!got.error || !!got.result?.isError };
}

const short = (s: string, n = 300): string => (s.length > n ? `${s.slice(0, n)}…` : s);

export async function runStand(msg: JsonRpcMessage): Promise<JsonRpcMessage> {
  const a = msg.params?.arguments ?? {};
  const realm = typeof a.realm === "string" ? a.realm.trim() : "";
  const karta = a.karta != null ? String(a.karta).trim().replace(/^#/, "") : "";
  const lines: string[] = [];
  const done = (isError = false): JsonRpcMessage => ({
    jsonrpc: "2.0",
    id: msg.id,
    result: {
      ...(isError ? { isError: true } : {}),
      content: [{ type: "text", text: lines.join("\n") }],
    },
  });
  if (!realm || !karta) {
    lines.push(
      "Отказано (мост): iskron_stand требует realm и karta — граф и роль из AGENTS.md или строки запуска.",
    );
    return done(true);
  }
  const name = typeof a.name === "string" && a.name.trim() ? sanitize(a.name.trim()) : deriveName();
  const room = typeof a.room === "string" && a.room.trim() ? a.room.trim() : null;

  // 1. Доска — до любой перемены.
  const board = await call("iskron_channel", { action: "list", realm });
  if (board.isError) {
    lines.push(`Отказано: доска не прочиталась — ${short(board.text)}`);
    return done(true);
  }
  const entries = parseBoard(board.text);
  // Доска — проза сервера (#4514). Управляющие действия — ротация, стук, хук —
  // идут только по распознанной однозначной форме; иначе честный отказ.
  const header = /^\s*Каналы(?:\s*\((\d+)\))?(?:\s|:|$)/m.exec(board.text);
  const declared = header?.[1] != null ? Number(header[1]) : null;
  const recognized = !!header || entries.length > 0;
  const truncated = declared != null && declared !== entries.length;
  const own = entries.filter((e) => e.karta === karta && e.address.endsWith(`:${name}`));
  if (!recognized || truncated || own.length > 1) {
    lines.push(
      !recognized
        ? `Отказано: форма доски не распознана — ни заголовка «Каналы», ни строк мест; управляющих действий (connect, стук, хук) по догадке не делаю. Начало ответа: ${short(board.text, 160)}`
        : truncated
          ? `Отказано: доска объявляет ${declared} мест, разобрано ${entries.length} — список усечён или форма сменилась; без полной доски чужой сокет ротировать нельзя.`
          : `Отказано: на доске ${own.length} места с именем ${name} у роли #${karta} — форма неоднозначна, состояние не определить.`,
    );
    return done(true);
  }
  const mine = own[0];
  let incoming = mine?.incoming ?? null;

  // 2. Место. Свой сокет держит этот мост — register. Место слушает ДРУГОЙ мост
  // (та же рабочая копия в другой сессии) — тоже register: живое стояние не
  // ротируется без причины (#4342), а причина называется явно — take=true.
  // Иначе connect и register; новый сокет — новый цикл входа, счёт стуков сброшен.
  let how: string;
  let heardHere: boolean;
  const listensElsewhere =
    !!mine && /(^|·)\s*слушает/.test(mine.rest) && !holdsStanding(realm, karta, name);
  // take=true — явный новый цикл входа: connect и тогда, когда сокет уже наш.
  if (a.take !== true && (holdsStanding(realm, karta, name) || listensElsewhere)) {
    const r = await call("iskron_channel", { action: "register", realm, karta, name });
    if (r.isError) {
      lines.push(`Отказано: register — ${short(r.text)}`);
      return done(true);
    }
    heardHere = !listensElsewhere;
    how = listensElsewhere
      ? "место уже слушает другой держатель (обычно прежняя сессия этой рабочей копии; при явном name — возможно, другая машина или человек) — только register: атрибуция есть, слух — у него; нужен слух здесь — повтори с take=true, сознавая, что снимешь слух с того держателя, или возьми другое имя (name)"
      : "сокет уже держит этот мост — register";
  } else {
    const args: Record<string, unknown> = { action: "connect", realm, karta, name };
    if (typeof a.mute_siblings === "boolean") args.mute_siblings = a.mute_siblings;
    releaseStanding("новый вход"); // свежий сокет и свежий hello — доказательство за ЭТОТ вызов, не за прошлый
    const c = await call("iskron_channel", args);
    if (c.isError) {
      lines.push(`Отказано: connect — ${short(c.text)}`);
      return done(true);
    }
    incoming = /https?:\/\/\S+\/channel\/in\/\S+/.exec(c.text)?.[0] ?? incoming;
    const r = await call("iskron_channel", { action: "register", realm, karta, name });
    if (r.isError) {
      lines.push(`Место занято, но register отказал — ${short(r.text)}`);
      return done(true);
    }
    for (const k of [...knocks.keys()])
      if (k.startsWith(`${realm}|${karta}|${name}|`)) knocks.delete(k);
    heardHere = true;
    how = mine
      ? listensElsewhere
        ? "место слушал другой держатель — connect по take (сокет теперь у этого моста, прежний держатель получил 4000) и register"
        : a.take === true
          ? "connect по take — новый цикл входа, счёт стуков сброшен — и register"
          : "место было — connect (сокет теперь у этого моста) и register"
      : "connect и register";
  }
  lines.push(
    `[iskron_stand] стояние ${mine?.address ?? name} — роль #${karta}, граф ${realm}: ${how}.`,
  );
  const block = heardHere ? listenBlock() : null;
  if (block) lines.push(block);
  else if (!heardHere)
    lines.push(
      "Команда сторожа не выдаётся: сокет у другого держателя, местного нет — эта сессия кадры и приглашения не принимает.",
    );
  else lines.push("Сокета у моста нет — слушать нечем; проверь ответ connect.");

  // 3. hello — доказательство держания; свежий он только за connect этого вызова.
  if (!heardHere) lines.push("Слух — у другого держателя; здесь только атрибуция записей.");
  else if (how.startsWith("сокет уже держит"))
    lines.push("Сокет держит этот мост (hello был получен при занятии места).");
  else {
    const hello = await awaitHello(4000);
    if (hello) lines.push(`hello получен: ожидало кадров — ${hello.pending ?? 0}.`);
    else
      lines.push(
        "hello за 4 с не пришёл — сокет мост держит, но доказательства слуха ещё нет: проверь доску.",
      );
  }

  // 4. Хук инбокса роли — чтобы вимарша posed_to приходила тем же сокетом.
  const hooks = await call("iskron_admin", { action: "list_webhooks", realm, node_id: karta });
  const hooksRecognized = !hooks.isError && /^\s*Вебхуки(?:\s|:|\(|$)/m.test(hooks.text);
  const nameRe = new RegExp(`:${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9._-])`);
  const wakesMe =
    hooksRecognized &&
    hooks.text.split(/\n(?=\s*#\d+\s*→)/).some((b) => /активен/.test(b) && nameRe.test(b));
  if (wakesMe) lines.push("Хук инбокса роли: стоит и будит это стояние.");
  else if (!hooksRecognized)
    lines.push(
      `Хук инбокса роли: список хуков не распознан — не трогаю (${short(hooks.text, 120)}).`,
    );
  else if (!heardHere) lines.push("Хук инбокса роли: не взвожу — слух у другого держателя.");
  else if (!incoming)
    lines.push("Хук инбокса роли: не взведён — входящий адрес стояния не прочитался.");
  else {
    const h = await call("iskron_admin", {
      action: "add_webhook",
      realm,
      node_id: karta,
      url: incoming,
      ttl_seconds: 0,
    });
    lines.push(
      h.isError
        ? `Хук инбокса роли: не взвёлся — ${short(h.text)}`
        : `Хук инбокса роли: взведён (${short(h.text, 120)}).`,
    );
  }

  // 5. Стук в комнату — по полному адресу с провода. Правило #4342: один стук,
  // повтор один раз не раньше чем через две минуты, дальше — слово человеку.
  if (room && !heardHere) {
    lines.push(
      `Комната ${room}: стук не отправлен — ответ комнаты ушёл бы держателю сокета, не сюда; нужен вход здесь — повтори с take=true или с другим name.`,
    );
  } else if (room) {
    const onBoard = entries.find((e) => e.address === room);
    const roomKarta =
      onBoard?.karta ??
      (typeof a.room_karta === "string" && a.room_karta.trim()
        ? a.room_karta.trim().replace(/^#/, "")
        : null);
    const key = `${realm}|${karta}|${name}|${room}`;
    const prior = knocks.get(key);
    const waited = prior ? Date.now() - prior.at : Infinity;
    const again = a.repeat_knock === true;
    if (prior && prior.count >= KNOCK_LIMIT) {
      lines.push(
        `Комната ${room}: стучал дважды, приглашения нет — больше не стучу в этом заходе; скажи человеку, что комната не ответила, и попроси открыть чат (счёт сбрасывает новый вход: take=true или новая сессия).`,
      );
    } else if (prior && !again) {
      lines.push(
        `Комната ${room}: стук уже отправлен ${Math.round(waited / 1000)} с назад — жди приглашения; осознанный повтор — тем же вызовом с repeat_knock=true, не раньше чем через ${Math.round(KNOCK_REPEAT_AFTER_MS / 1000)} с.`,
      );
    } else if (prior && waited < KNOCK_REPEAT_AFTER_MS) {
      lines.push(
        `Комната ${room}: повтор рано — с первого стука прошло ${Math.round(waited / 1000)} с, правило ждёт ${Math.round(KNOCK_REPEAT_AFTER_MS / 1000)} с; повтори через ${Math.ceil((KNOCK_REPEAT_AFTER_MS - waited) / 1000)} с.`,
      );
    } else if (!roomKarta) {
      lines.push(
        `Комната ${room}: на доске графа ${realm} этого стояния нет, а send требует роль его держателя — стук не отправлен. Стояние комнаты живёт присутствием человека: либо он ушёл дольше порога (попроси открыть чат и повтори), либо передай room_karta=<роль человека комнаты>.`,
      );
    } else {
      const s = await call("iskron_channel", {
        action: "send",
        realm,
        karta: roomKarta,
        standing: room,
        text: "join",
      });
      if (s.isError) lines.push(`Комната ${room}: стук отказан — ${short(s.text)}`);
      else {
        knocks.set(key, { at: Date.now(), count: (prior?.count ?? 0) + 1 });
        lines.push(
          `Комната ${room}: ${prior ? "повторный " : ""}стук отправлен — ${short(s.text, 200)} Жди первого слова комнаты с шапкой; до него в комнату не пиши.`,
        );
      }
    }
  }

  // 6. Занятость.
  if (typeof a.status === "string" && a.status.trim() && !heardHere) {
    lines.push("Занятость не публикуется: статусный адрес у держателя сокета.");
  } else if (typeof a.status === "string" && a.status.trim()) {
    const st = await publishStatus(a.status.trim());
    lines.push(st.ok ? `Занятость: ${a.status.trim()}` : `Занятость не принята: ${short(st.body)}`);
  }
  const stale = staleNotice(readLatest(CFG.authDir), CFG.authDir);
  if (stale) lines.push(stale);
  return done();
}
