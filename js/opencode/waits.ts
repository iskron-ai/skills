// Ребёнок, которого родитель не слышит (дело №147; граф nks-dev: поверхность OpenCode 2, #5048).
// Фоновый субагент (background=true) на запросе разрешения висит без таймаута: ответить
// в фоне некому, ход не кончается, и родитель не получает <subagent state=…> вовсе. Запрос
// виден событием permission.asked (Permission.Request: id, sessionID, action, resources;
// родителя в нём нет — он из session.get), снятие — permission.replied (requestID).
// Прерванный не отменой ход ребёнка без места-спутника (shutdown, superseded, inactivity)
// плагин не видел вовсе: leads.ts слышит только ведущих, у них своя логика (#6550 п.4).
// Поток событий общий для сервиса: своё — сессия, чей каталог после realpath — каталог
// экземпляра; экземпляры по написанию каталога делят модуль, и слово идёт раз — по id.
/* eslint-disable @typescript-eslint/no-explicit-any -- события и ответы SDK без схемы */
import { realpathSync } from "node:fs";

import { sleep } from "./bridge-io.ts";
import { homeOf } from "./host.ts";
import type { Context } from "./plugin.ts";

/** Запрос, снятый за это время (человек ответил в окне ребёнка), родителю не называется. */
const WAIT_MS = Number(process.env.ISKRON_PERMISSION_WAIT_MS) || 20_000;
/** Ресурсов в слове — не больше; каждый — не длиннее. */
const RESOURCES = 3;
const RESOURCE_MAX = 160;

/** Сказанное — на модуль, не на экземпляр: экземпляры одного процесса делят его. */
const told = new Set<string>();
function once(key: string): boolean {
  if (told.has(key)) return false;
  told.add(key);
  if (told.size > 1000) told.delete(told.values().next().value as string);
  return true;
}

export interface WaitDoors {
  /** Синтетика в сессию родителя — steer; wake — будить ли простаивающую. */
  tell(session: string, text: string, wake: boolean): Promise<void>;
  /** Ведущий субагент (спутник) — его прерывания ведёт leads.ts. */
  isLead(child: string): boolean;
}

const canon = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

export const askWord = (who: string, action: string, resources: string[]): string => {
  const cut = resources.slice(0, RESOURCES).map((r) => {
    const one = r.replace(/\s+/g, " ").trim();
    return one.length > RESOURCE_MAX ? `${one.slice(0, RESOURCE_MAX)}…` : one;
  });
  const more = resources.length > RESOURCES ? ` и ещё ${resources.length - RESOURCES}` : "";
  const what = cut.length ? `${action}: ${cut.join("; ")}${more}` : action;
  return `Искрон: субагент ${who} ждёт разрешения: ${what} — ответь в его сессии или отмени его ход.`;
};

export const interruptWord = (who: string, reason: string): string =>
  `Искрон: ход субагента ${who} прерван (${reason}).`;

export function createWaits(ctx: Context, d: WaitDoors) {
  const home = homeOf(ctx);
  const own = home ? canon(home.directory) : null;
  const answered = new Set<string>();
  let stopped = false;

  /** Ребёнок этого каталога: родитель и имя; корень, чужой каталог, нечитаемая сессия — null. */
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
    if (own && typeof dir === "string" && dir && canon(dir) !== own) return null;
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
    await d.tell(kid.parent, askWord(kid.who, String(action ?? "действие"), list), true);
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
