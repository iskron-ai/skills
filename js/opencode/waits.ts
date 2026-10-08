// Ребёнок, которого родитель не слышит (дело №147; граф nks-dev: поверхность OpenCode 2, #5048).
// Фоновый субагент (background=true) на запросе разрешения висит без таймаута: ответить
// в фоне некому, ход не кончается, и родитель не получает <subagent state=…> вовсе. Запрос
// виден событием permission.asked (Permission.Request: id, sessionID, action, resources;
// родителя в нём нет — он из session.get), снятие — permission.replied (requestID).
// Прерванный не отменой ход ребёнка без места-спутника (shutdown, superseded, inactivity)
// плагин не видел вовсе: leads.ts слышит только ведущих, у них своя логика (#6550 п.4).
// Поток событий общий для сервиса: своё — сессия, чей каталог СТРОКОЙ равен каталогу
// экземпляра, не после realpath. На каждое написание каталога (/tmp/W, /private/tmp/W)
// свой экземпляр, и хуки, тулы и ведущие ребёнка живут только в экземпляре его написания —
// только он знает, ведущий ли ребёнок; набор ведущих на модуль держался бы на общей копии
// модуля и пережил бы выгрузку своего экземпляра. Слово — одно, от экземпляра написания.
// Цена: у не фонового ребёнка слово ляжет после ответа человека; shutdown до ответа session.get его теряет.
/* eslint-disable @typescript-eslint/no-explicit-any -- события и ответы SDK без схемы */
import { envName } from "../delivery/index.ts";
import { L } from "../shared/lang.ts";
import { sleep } from "./bridge-io.ts";
import { homeOf } from "./host.ts";
import type { Context } from "./plugin.ts";

/** Запрос, снятый за это время (человек ответил в окне ребёнка), родителю не называется. */
const WAIT_MS = Number(process.env[envName("PERMISSION_WAIT_MS")]) || 20_000;
/** Ресурсов в слове — не больше; каждый — не длиннее. */
const RESOURCES = 3;
const RESOURCE_MAX = 160;

export interface WaitDoors {
  /** Синтетика в сессию родителя — steer; wake — будить ли простаивающую. */
  tell(session: string, text: string, wake: boolean): Promise<void>;
  /** Ведущий субагент (спутник) — его прерывания ведёт leads.ts. */
  isLead(child: string): boolean;
}

export const askWord = (who: string, action: string, resources: string[]): string => {
  const cut = resources.slice(0, RESOURCES).map((r) => {
    const one = r.replace(/\s+/g, " ").trim();
    return one.length > RESOURCE_MAX ? `${one.slice(0, RESOURCE_MAX)}…` : one;
  });
  const n = resources.length - RESOURCES;
  const more = n > 0 ? L(` и ещё ${n}`, ` and ${n} more`) : "";
  const what = cut.length ? `${action}: ${cut.join("; ")}${more}` : action;
  // Слово «ответь в его сессии» модель родителя поняла как «напиши ребёнку» (живой прогон 7.4.0):
  // ответ на запрос разрешения из сессии родителя невозможен, его даёт только человек в окне ребёнка.
  // Отмены хода ребёнка у родителя тоже нет — и её слово отдаёт человеку.
  return L(
    `Искрон: субагент ${who} ждёт разрешения: ${what}. Ответить на этот запрос может только человек — в окне сессии субагента ${who}. ` +
      "Ты ответить не можешь, и никакое слово субагенту его не разблокирует. " +
      "Скажи человеку, что и где ждёт: ответить или отменить ход субагента может только он.",
    `Iskron: subagent ${who} is waiting for a permission: ${what}. Only the human can answer this request — in the window of the subagent's session ${who}. ` +
      "You cannot answer it, and no message to the subagent unblocks it. " +
      "Tell the human what is waiting and where: only they can answer or cancel the subagent's turn.",
  );
};

export const interruptWord = (who: string, reason: string): string =>
  L(
    `Искрон: ход субагента ${who} прерван (${reason}).`,
    `Iskron: the turn of subagent ${who} was interrupted (${reason}).`,
  );

export function createWaits(ctx: Context, d: WaitDoors) {
  const home = homeOf(ctx);
  const answered = new Set<string>();
  const told = new Set<string>();
  const once = (key: string): boolean => {
    if (told.has(key)) return false;
    told.add(key);
    if (told.size > 1000) told.delete(told.values().next().value as string);
    return true;
  };
  let stopped = false;

  /** Ребёнок написания этого экземпляра: родитель и имя; корень, иное написание, нечитаемая сессия — null. */
  async function childOf(
    sessionID: string,
    ev: any,
  ): Promise<{ parent: string; who: string } | null> {
    const res: any = await Promise.resolve()
      .then(() => ctx.session.get({ sessionID } as any))
      .catch(() => null);
    const s = res?.data ?? res;
    const parent: unknown = s?.parentID;
    if (typeof parent !== "string" || !parent) return null;
    const dir: unknown = s?.location?.directory ?? ev?.location?.directory;
    if (home && typeof dir === "string" && dir && dir !== home.directory) return null;
    const title = typeof s?.title === "string" ? s.title.trim() : "";
    return { parent, who: title ? `«${title}» (${sessionID})` : sessionID };
  }

  async function asked(ev: any): Promise<void> {
    const { id, sessionID, action, resources } = ev?.data ?? {};
    if (typeof id !== "string" || typeof sessionID !== "string" || told.has(id)) return;
    await sleep(WAIT_MS);
    if (stopped || answered.has(id)) return;
    const kid = await childOf(sessionID, ev);
    if (!kid || answered.has(id) || !once(id)) return;
    const list = Array.isArray(resources) ? resources.map(String) : [];
    await d.tell(
      kid.parent,
      askWord(kid.who, String(action ?? L("действие", "action")), list),
      true,
    );
  }

  async function interrupted(ev: any): Promise<void> {
    const { sessionID, reason } = ev?.data ?? {};
    if (typeof sessionID !== "string" || typeof reason !== "string" || reason === "user") return;
    if (d.isLead(sessionID)) return;
    const kid = await childOf(sessionID, ev);
    const key = typeof ev?.id === "string" ? ev.id : `${sessionID}@${ev?.created ?? reason}`;
    if (!kid || stopped || d.isLead(sessionID) || !once(key)) return;
    await d.tell(kid.parent, interruptWord(kid.who, reason), false);
  }

  return {
    onEvent(ev: any): void {
      switch (ev?.type) {
        case "permission.asked":
          void asked(ev);
          return;
        case "permission.replied":
          if (typeof ev.data?.requestID !== "string") return;
          answered.add(ev.data.requestID);
          if (answered.size > 1000) answered.delete(answered.values().next().value as string);
          return;
        case "session.execution.interrupted":
          void interrupted(ev);
          return;
      }
    },
    stop(): void {
      stopped = true;
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
