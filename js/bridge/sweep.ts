// Уборка мёртвых ключей стояний перед тем, как мост положит свой (см. hold.ts).
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { connect as connectLocal } from "node:net";
import { join } from "node:path";

import { seenFilePathOf, socketPathOf, standingsDirOf } from "../shared/standings.ts";

/**
 * Мост, убитый без прощания, оставляет `.key` и `.sock`: сторож без аргумента
 * перечисляет ключи, и мёртвая запись либо уводит его на сокет, где никого нет,
 * либо заставляет отказать «стояний несколько». Перед тем как положить свой
 * ключ, каждый чужой проверяется одним подключением; неотвечающий — убирается.
 */
export function sweepStale(authDir: string, mine: string): void {
  const dir = standingsDirOf(authDir);
  if (process.platform === "win32" || !existsSync(dir)) return;
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
