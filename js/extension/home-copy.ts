// Где лежит мост и как его домашняя копия держится в ногу с поставкой.
import {
  accessSync,
  chmodSync,
  constants,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { versionIn } from "../shared/version.ts";

export type Notify = (text: string, level?: "info" | "warning" | "error") => void;

/** Строгое сравнение X.Y.Z: 1 если a новее b, -1 если старее, 0 если равны или нечитаемо. */
export function newer(a: string, b: string): number {
  const pa = a.split(".").map(Number),
    pb = b.split(".").map(Number);
  if (pa.length !== 3 || pb.length !== 3 || [...pa, ...pb].some((n) => !Number.isInteger(n)))
    return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  return 0;
}

/**
 * Путь к мосту, приехавшему в этом же пакете. Выводится ОДИН раз и служит обеим
 * половинам: той, что зеркалит копию домой, и той, что мост поднимает. Разъехавшись,
 * они зеркалили бы один файл, а запускали другой, и молча.
 * Бросает, когда загрузчик не дал собственного пути, — звать под try.
 */
export function packagedBridgePath(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "skills",
    "establish-mcp",
    "scripts",
    "iskron.mjs",
  );
}

/** Имя домашней копии — контракт с конфигами харнесов, и оно не меняется с именем файла в поставке. */
export const homeBridgePath = (): string => join(homedir(), ".iskron-bridge", "iskron-bridge.mjs");

/**
 * Обновление поставки НЕ обновляло мост: расширение предпочитает домашнюю копию,
 * потому что рядом с ней лежит грант, — и делатель работал старым, считая, что
 * обновился. Наблюдено на штатной установке сразу после релиза: код 6.0.0 поднял
 * мост 5.0.0. Дорого это тем, что мост штампует сборку в каждую ошибку и в лог
 * гранта: полевой репорт с новой поставки приходил бы со старым числом.
 *
 * Грант замену переживает, и это ПРОВЕРЕНО, а не предположено: всё состояние
 * входа живёт отдельными файлами в том же каталоге, а имя хранилища выводится из
 * адреса сервера, не из пути и не из байт скрипта. В приёмке новый мост
 * воспользовался refresh-токеном, оставленным старым.
 *
 * ПРАВИЛО СРАВНЕНИЯ — по байтам, а не по версии, и это исправление собственной
 * ошибки. Версия есть номер РЕЛИЗА, а не тождество файла: при установке из
 * git-источника едет ветка, а константа между релизами стоит на месте, — сверка
 * по версии не сработала бы никогда именно там, где поставка обновляется чаще
 * всего. Мост и сам различает себя хешем собственных байт, и скилл транспорта
 * говорит это строкой выше. Поэтому: домашняя копия должна ЗЕРКАЛИТЬ ту, что
 * приехала с поставкой, — кроме случая, когда её версия строго новее.
 *
 * Ограды. Строго новее дома — не трогаем, потому что это мог быть свежий мост,
 * положенный человеком руками. Путь, заданный переменной, не трогаем вовсе:
 * выбор человека старше нашей заботы. И НЕТ ГОЛОСА — НЕТ ПОДМЕНЫ: в сессии, где
 * сказать нечем, копия не меняется; чинить не запрещено, чинить молча запрещено,
 * и молчание здесь не оправдание, а условие отказа.
 */
export function refreshHomeBridge(notify: Notify, canSpeak: boolean): void {
  if (process.env.ISKRON_BRIDGE_PATH?.trim()) return;
  if (!canSpeak) return; // сказать нечем — значит и менять нечего: тихой подмены не бывает
  let packagedPath: string;
  try {
    packagedPath = packagedBridgePath();
  } catch {
    return; // загрузчик не дал собственного пути — сравнивать не с чем
  }
  const homePath = homeBridgePath();
  let packaged: Buffer;
  try {
    packaged = readFileSync(packagedPath);
  } catch {
    return; // поставка моста не несёт — это дело establish-mcp, не наше
  }
  const vPackaged = versionIn(packaged.toString("utf8"));
  if (!vPackaged) {
    // Сама починка мертва: файл на месте, а прочесть его версию нечем.
    notify(
      "Искрон: в поставке мост есть, но его версия не читается — домашнюю копию не трогаю.",
      "warning",
    );
    return;
  }

  let home: Buffer;
  try {
    home = readFileSync(homePath);
  } catch {
    return; // домашней копии ещё нет — её заводит establish-mcp, не мы
  }
  if (home.equals(packaged)) return; // байт в байт — говорить не о чем

  const vHome = versionIn(home.toString("utf8"));
  if (vHome && newer(vHome, vPackaged) > 0) {
    notify(
      `Искрон: дома мост ${vHome}, в поставке ${vPackaged} — домашний новее, не трогаю.`,
      "warning",
    );
    return;
  }

  const was = vHome ?? "версия не читается";
  const tmp = `${homePath}.tmp-${process.pid}`; // имя с pid: два старта рядом не пишут в один файл
  try {
    writeFileSync(tmp, packaged);
    chmodSync(tmp, 0o755);
    renameSync(tmp, homePath);
    notify(
      vHome === vPackaged
        ? `Искрон: мост дома заменён на привезённый поставкой — версия та же (${vPackaged}), байты другие. Грант не тронут.`
        : `Искрон: мост дома обновлён ${was} → ${vPackaged}. Грант не тронут, он лежит рядом отдельными файлами.`,
      "info",
    );
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* нечего убирать */
    }
    notify(
      `Искрон: мост дома ${was}, в поставке ${vPackaged}, заменить не вышло (${(e as Error).message}). Работаю тем, что есть.`,
      "warning",
    );
  }
}

/** Путь к мосту выводится, не зашивается: расширение и мост едут одним репозиторием. */
export function findBridge(): { path: string; tried: string[] } | { path: null; tried: string[] } {
  const tried: string[] = [];
  const push = (p: string | null | undefined) => {
    if (!p) return;
    tried.push(p);
  };
  push(
    process.env.ISKRON_BRIDGE_PATH?.trim() ? resolve(process.env.ISKRON_BRIDGE_PATH.trim()) : null,
  );
  push(homeBridgePath());
  try {
    // pi install git:… кладёт расширение рядом со скиллами того же репозитория.
    push(packagedBridgePath());
  } catch {
    /* загрузчик не дал собственного пути — остаются первые два кандидата */
  }
  for (const candidate of tried) {
    try {
      accessSync(candidate, constants.R_OK);
      return { path: candidate, tried };
    } catch {
      /* следующий кандидат */
    }
  }
  return { path: null, tried };
}
