// Состояние сессии моста — не процесса (шаг 2 к 7.0.0: демон машины держит
// много сессий в одном процессе). Полный мост — процесс с одной сессией: его
// состояние лежит в области процесса, как прежде. Демон открывает каждую
// сессию в своей области (AsyncLocalStorage): конфиг, транспорт, место,
// поток вывода, pid, cwd и окружение моста харнеса — её, а не демона.
//
// Модуль с состоянием держит его через scoped(): значение заводится лениво в
// области, из которой к нему обратились. Область доходит сама по цепочкам
// промисов и таймеров; обработчик события, повешенный внутри сессии и
// зовущийся извне (строка входа, кадр сокета, клиент двери), оборачивается
// bindScope — иначе он увидел бы область процесса, то есть чужое состояние.
import { AsyncLocalStorage } from "node:async_hooks";

/** Откуда сессия — мост харнеса, каким его запустили (рукопожатие шва). */
export interface ScopeOrigin {
  /** Окружение моста харнеса — только ключи сессии (shared/seam.ts isSessionEnvKey). */
  env: Record<string, string>;
  cwd: string;
  pid: number;
  /** Файл моста харнеса: по нему находится набор скиллов (skillset.ts). */
  path: string;
}

export interface Scope {
  readonly id: string;
  /** null — область процесса: окружение, cwd и pid — самого процесса. */
  readonly origin: ScopeOrigin | null;
  /** Ключи окружения, которые в этой области — слово сессии (остальные — процесса). */
  readonly sessionKey: (k: string) => boolean;
  readonly slots: Map<object, unknown>;
  /** Куда пишется слово log этой области; null — stderr процесса (или журнал демона). */
  log: ((line: string) => void) | null;
}

const als = new AsyncLocalStorage<Scope>();
const PROCESS: Scope = {
  id: "process",
  origin: null,
  sessionKey: () => false,
  slots: new Map(),
  log: null,
};

export const currentScope = (): Scope => als.getStore() ?? PROCESS;
export const processScope = (): Scope => PROCESS;
/** Внутри области сессии (демон), а не процесса. */
export const inSessionScope = (): boolean => !!als.getStore()?.origin;

export function newScope(
  id: string,
  origin: ScopeOrigin,
  sessionKey: (k: string) => boolean,
): Scope {
  return { id, origin, sessionKey, slots: new Map(), log: null };
}

export const runIn = <T>(scope: Scope, fn: () => T): T => als.run(scope, fn);

/** Обработчик, который зовут извне области, — исполнить в области, где он повешен. */
export function bindScope<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  const s = als.getStore();
  return s ? (...a: A) => als.run(s, () => fn(...a)) : fn;
}

/** bindScope над каждым обработчиком объекта опций (сокет канала, дверь). */
export const bindAll = <T extends object>(o: T): T =>
  Object.fromEntries(
    Object.entries(o).map(([k, v]) => [
      k,
      typeof v === "function" ? bindScope(v as (...a: unknown[]) => unknown) : v,
    ]),
  ) as T;

/**
 * Значение на область: объект (или Map, Set), заводимый init при первом
 * обращении из области. Прокси отдаёт поля и методы значения своей области —
 * модуль пишет `S.x` и `map.get(k)`, как писал бы по модульной переменной.
 */
export function scoped<T extends object>(init: () => T): T {
  const key = {};
  const own = (): T => {
    const slots = currentScope().slots;
    let v = slots.get(key) as T | undefined;
    if (v === undefined) {
      v = init();
      slots.set(key, v);
    }
    return v;
  };
  return new Proxy({} as T, {
    get: (_, k) => {
      const t = own();
      const v = Reflect.get(t, k, t) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
    set: (_, k, v) => Reflect.set(own(), k, v),
    has: (_, k) => Reflect.has(own(), k),
    deleteProperty: (_, k) => Reflect.deleteProperty(own(), k),
    ownKeys: () => Reflect.ownKeys(own()),
    getOwnPropertyDescriptor: (_, k) => {
      const d = Reflect.getOwnPropertyDescriptor(own(), k);
      if (d) d.configurable = true;
      return d;
    },
  });
}

/** Переменная окружения глазами области: ключ сессии — из окружения моста харнеса. */
export function envOf(k: string): string | undefined {
  const s = currentScope();
  if (s.origin && s.sessionKey(k)) return s.origin.env[k];
  return process.env[k];
}

/** pid того, чья это сессия: мост харнеса, а не демон. */
export const sessionPid = (): number => currentScope().origin?.pid ?? process.pid;
/** Каталог, из которого харнес запустил мост. */
export const sessionCwd = (): string => currentScope().origin?.cwd ?? process.cwd();
