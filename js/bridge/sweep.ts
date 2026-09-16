// Уборка мёртвых ключей стояний перед тем, как мост положит свой (см. hold.ts).
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
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

export function sweepStale(authDir: string, mine: string): void {
  const dir = standingsDirOf(authDir);
  if (!existsSync(dir)) return;
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
    const drop = (): void => {
      for (const p of [keyFile, sock, seenFilePathOf(authDir, key)]) {
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
