// Уборка мёртвых ключей стояний перед тем, как мост положит свой (см. hold.ts).
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { connect as connectLocal } from "node:net";
import { join } from "node:path";

import { seenFilePathOf, socketPathOf, standingsDirOf } from "../shared/standings.ts";
import { HOLD_RECORD_MAX_AGE_MS } from "./holdrecord.ts";

/**
 * Мост, убитый без прощания, оставляет `.key` и `.sock`: сторож без аргумента
 * перечисляет ключи, и мёртвая запись либо уводит его на сокет, где никого нет,
 * либо заставляет отказать «стояний несколько». Перед тем как положить свой
 * ключ, каждый чужой проверяется одним подключением; неотвечающий — убирается.
 */
/** Слушает ли кто-то локальный сокет стояния — живой мост держит его, мёртвый оставил файл. */
export function localSocketAlive(sock: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform !== "win32" && !existsSync(sock)) return resolve(false);
    const probe = connectLocal(sock);
    const done = (v: boolean): void => {
      probe.destroy();
      resolve(v);
    };
    probe.once("connect", () => done(true));
    probe.once("error", () => done(false));
    probe.setTimeout(1000, () => done(false));
  });
}

/**
 * Сколько живёт память отданного (.seen) места, которое никто не держит: она
 * переживает мост, потому что платформа отдаёт очередь места снова и назавтра
 * (#5831), но не вечно — иначе каталог копил бы файл на каждое имя.
 */
const SEEN_FILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function sweepStale(authDir: string, mine: string): void {
  const dir = standingsDirOf(authDir);
  if (!existsSync(dir)) return;
  const mineSeen = seenFilePathOf(authDir, mine);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".seen"))) {
    const p = join(dir, f);
    if (p === mineSeen || existsSync(join(dir, f.replace(/\.seen$/, ".key")))) continue;
    try {
      if (Date.now() - statSync(p).mtimeMs > SEEN_FILE_MAX_AGE_MS) unlinkSync(p);
    } catch {}
  }
  // Записи держания старше срока простоя места — мертвы у платформы, стираются здесь.
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".hold"))) {
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as { at?: number };
      if (typeof rec.at !== "number" || Date.now() - rec.at > HOLD_RECORD_MAX_AGE_MS)
        unlinkSync(join(dir, f));
    } catch {
      try {
        unlinkSync(join(dir, f));
      } catch {}
    }
  }
  if (process.platform === "win32") return;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".key"))) {
    const keyFile = join(dir, f);
    let key: string;
    try {
      key = readFileSync(keyFile, "utf8").trim();
    } catch {
      continue;
    }
    if (!key || key === mine) continue;
    const sock = socketPathOf(authDir, key);
    // Память отданного остаётся: место мёртвого моста вернёт другой, и очередь придёт снова.
    const drop = (): void => {
      for (const p of [keyFile, sock]) {
        try {
          unlinkSync(p);
        } catch {}
      }
    };
    if (!existsSync(sock)) {
      drop();
      continue;
    }
    const probe = connectLocal(sock);
    probe.once("connect", () => probe.destroy());
    probe.once("error", drop);
    probe.setTimeout(1000, () => probe.destroy());
  }
}
