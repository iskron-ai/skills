// Какие записи держания возврат места (resume.ts) считает своими (граф nks-dev: #5151, #6017).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { sameDir as oneDir } from "../shared/canon.ts";
import { standingsDirOf } from "../shared/standings.ts";
import { harnessName } from "./client.ts";
import { CFG } from "./config.ts";
import { ledKey } from "./hold.ts";
import { type HoldRecord, keyOf, readHoldRecord } from "./holdrecord.ts";

export interface ResumeSelector {
  /** ключ стояния — предпочтение: точный адрес записи */
  key?: string;
  /** каталог сессии — откат: записи этого харнесса из этого каталога, стоявшие этой сессией, свежайшая первой */
  cwd?: string;
  /** сессия харнесса, чей это мост: по каталогу своей записью считается только стоявшая ею (#6017) */
  session?: string;
}

/**
 * Свои записи держания под выбором — тот же харнесс; по ключу первой, затем по
 * каталогу, свежайшая первой. Ключ — предпочтение, каталог — откат, не «или»:
 * устаревший ключ (мост убит между released и held, подсказка из маркера) не
 * должен глушить живую запись того же каталога.
 * «Своя» по каталогу — только запись, на которой стояла ЭТА сессия, либо место,
 * которое ведёт сам этот мост: каталог не отличает возвращения от первого
 * появления, и сессия, никогда не стоявшая, унаследовала бы место ушедшего
 * держателя со всем его рассказом о работе (#6017). Ключ сессия знает, только
 * если держала его сокет (`held` своего моста, маркер своей потери).
 * Место, отпущенное словом держателя (`left`), своим не считается никак —
 * вернуть его может только iskron_stand по имени.
 * `sameDir` — все записи этого харнесса того же каталога, для слова «с кем делишь каталог»;
 * `legacy` — записи прежней сборки без сессии в этом каталоге: по каталогу не берутся,
 * но называются вслух, чтобы их держатель вернул их по имени.
 */
export function recordsFor(sel: ResumeSelector): {
  own: HoldRecord[];
  sameDir: string[];
  legacy: HoldRecord[];
  left: string[];
  neighbour: string[];
} {
  const dir = standingsDirOf(CFG.authDir);
  if (!existsSync(dir)) return { own: [], sameDir: [], legacy: [], left: [], neighbour: [] };
  const mine = harnessName();
  const led = ledKey();
  const byKey: HoldRecord[] = [];
  const byCwd: HoldRecord[] = [];
  const sameDir: string[] = [];
  const legacy: HoldRecord[] = [];
  const left: string[] = [];
  const neighbour: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".hold"))) {
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as HoldRecord;
      if (!rec || rec.client !== mine) continue; // чужой харнесс — не наше место
      const key = keyOf(rec.realm, rec.karta, rec.name);
      const keyed = !!sel.key && key === sel.key;
      const inDir = oneDir(rec.cwd, sel.cwd); // /tmp и /private/tmp — один каталог (#5048)
      // Стоявшая этой сессией — её и вне каталога: сессию переносят между папками (#6550 п.3).
      const stoodBy = !!sel.session && rec.session === sel.session;
      if (!keyed && !inDir && !stoodBy) continue;
      // Чтение по ключу — то же, что у stand: просроченная запись стирается и не читается.
      const fresh = readHoldRecord(key);
      if (!fresh) continue;
      if (inDir) sameDir.push(key);
      if (fresh.left) {
        left.push(key);
        continue;
      }
      const stoodHere = key === led || (!!sel.session && fresh.session === sel.session);
      // По ключу — тоже не место соседа: на записи стояла другая названная сессия (#6706).
      const theirs = !!sel.session && !!fresh.session && fresh.session !== sel.session;
      if (keyed && theirs) neighbour.push(key);
      else if (keyed) byKey.push(fresh);
      else if (stoodHere) byCwd.push(fresh);
      else if (!fresh.session) legacy.push(fresh);
    } catch {
      /* чужой или битый файл — не наш */
    }
  }
  return {
    own: [...byKey, ...byCwd.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))],
    sameDir,
    legacy,
    left,
    neighbour,
  };
}
