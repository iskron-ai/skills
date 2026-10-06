// Экземпляры плагина одного каталога в одном процессе (граф nks-dev: #5048, дело №147).
// OpenCode 2.0.24 заводит экземпляр на каждое написание каталога (/tmp/A и /private/tmp/A);
// каталоги сравниваются канонизированными (shared/canon.ts), и оба считают сессию своей —
// место вернули бы дважды, двумя мостами. Корень сессии ведёт один экземпляр процесса —
// первый, кто его взял: вызов тула, возврат с диска, перенос сюда. Другой отдаёт ему вызовы
// тулов и строку запуска. Реестр — на globalThis: общий для копий модуля в процессе.
/* eslint-disable @typescript-eslint/no-explicit-any -- вызовы и ответы SDK без схемы */

type Exec = (input: any, tool: any) => Promise<any>;

/** Экземпляр, ведущий корень: его исполнение тулов и строка запуска. */
interface Owner {
  exec(name: string, input: any, tool: any): Promise<any>;
  launch(session: string, text: string): Promise<string | null>;
  live(): boolean;
}

const registry = (): Map<string, Owner> =>
  ((globalThis as any).__iskronRootOwners ??= new Map<string, Owner>());

/**
 * live — экземпляр не остановлен: корень остановленного берёт следующий, кто спросит.
 * folder — канонический каталог экземпляра с рабочим пространством: делят корень только
 * написания ОДНОГО каталога; экземпляр другой папки (перенос) — не близнец; без локации — один.
 */
export function createTwins(
  rootOf: (session: string) => Promise<string>,
  live: () => boolean,
  folder: string | null,
) {
  const own = new Map<string, Exec>(); // имя тула → его исполнение в этом экземпляре
  let launch: Owner["launch"] = async () => null;
  const me: Owner = {
    exec(name, input, tool) {
      const f = own.get(name);
      if (!f) return Promise.reject(new Error(`${name}: тула нет у экземпляра, ведущего сессию`));
      return f(input, tool);
    },
    launch: (s, text) => launch(s, text),
    live,
  };
  /** Корень свободен, наш или его экземпляр остановлен — взять; ведёт другой живой — false. */
  const keyOf = (root: string) => `${folder}\0${root}`;
  function claim(root: string): boolean {
    if (folder === null) return true;
    const reg = registry();
    const k = keyOf(root);
    if (!reg.get(k)?.live()) reg.set(k, me);
    return reg.get(k) === me;
  }
  /** Экземпляр, ведущий корень сессии; свободный корень берёт этот. */
  async function owner(session: string): Promise<Owner> {
    const root = await rootOf(session);
    return claim(root) ? me : (registry().get(keyOf(root)) ?? me);
  }
  return {
    claim,
    /** Редактор тулов, чьё исполнение идёт экземпляру, ведущему сессию вызова. */
    editor<E extends { add(t: any): unknown }>(raw: E): E {
      return Object.assign(Object.create(raw), {
        add: (t: any) => {
          own.set(t.name, t.execute);
          return raw.add({
            ...t,
            execute: async (input: any, tool: any) =>
              (await owner(String(tool.sessionID))).exec(t.name, input, tool),
          });
        },
      });
    },
    /** Строка запуска: исполняет её экземпляр, ведущий сессию. */
    launcher(f: Owner["launch"]): Owner["launch"] {
      launch = f;
      return async (s, text) => (await owner(s)).launch(s, text);
    },
    /** Корень ушёл отсюда (перенос в другую папку) — его возьмёт экземпляр той папки. */
    release(root: string): void {
      if (folder !== null && registry().get(keyOf(root)) === me) registry().delete(keyOf(root));
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
