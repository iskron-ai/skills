// Стенд проб выравнивания корня (rootseat-realign*.test.mjs, rootseat-outside.test.mjs): корень
// в каталоге с AGENTS.md без фронтматтера под настоящим плагином (rootseat-kit.mjs).
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { GLOBAL_PREFIX, REPO_SIGNS, ROOT_SEAT } from "../delivery/index.ts";
import { createHalts } from "../opencode/halts.ts";
import { placeArgs, setup } from "./ownseat-kit.mjs";
import { rootPlugin } from "./rootseat-kit.mjs";

export const T = { timeout: 90_000 };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prefix = (f) => f("\0", "\0", "\0", "\0").split("\0")[0];
/** Середина слова выравнивания — от причины до имени файла обложки. */
export const ALIGN = ROOT_SEAT.ru.realign("\0", "\0").split("\0")[1];
export const SEATED = prefix(ROOT_SEAT.ru.seated);
export const OWN = prefix(ROOT_SEAT.ru.ownSeated);
export const LATE = prefix(ROOT_SEAT.ru.late);
export const HUMAN = "словом человека";
export const stood = (w) => w.includes(SEATED) || w.includes(OWN);
export const resetStops = () => {
  for (const key of ["Halts", "LiftedAt", "StopIds", "StopWords"])
    delete globalThis[`${GLOBAL_PREFIX}${key}`];
};
export const halts = (s) =>
  createHalts(
    () => undefined,
    () => s.dir,
    () => {},
    () => {},
  );
export const connects = (s) => placeArgs(s.fake, "connect").length;
export const writeRaw = (dir, text) => writeFileSync(join(dir, "AGENTS.md"), text);

/**
 * Корень пробы. repo: "partial" (по умолчанию) — git-репозиторий с признаком выравнивания
 * (плагин ритуалов), приглашения онбординга нет; "fresh" — голый git-репозиторий, приглашение
 * есть; "none" — каталог вне репозитория. agents: true — AGENTS.md без фронтматтера.
 */
export async function aligning(t, { repo = "partial", agents = true, env = {} } = {}) {
  resetStops();
  // Before setup's own cleanup: the plugins stop first, so their bridges exit before it looks.
  const up = [];
  t.after(async () => {
    for (const p of up) await p.stop();
    resetStops();
  });
  const s = await setup(t);
  const project = realpathSync(s.cwd);
  if (repo !== "none") mkdirSync(join(project, ".git"));
  if (repo === "partial") {
    mkdirSync(join(project, REPO_SIGNS.rituals, ".."), { recursive: true });
    writeFileSync(join(project, REPO_SIGNS.rituals), "export default {};\n");
  }
  if (agents) writeRaw(project, "# проект\n\nОбложки ещё нет.\n");
  const start = async () => {
    const p = await rootPlugin(s, project, env);
    up.push(p);
    return p;
  };
  const oc = await start();
  oc.create("root");
  return { s, project, oc, start };
}

export const look = (oc, r) =>
  `модель прочла: ${r?.prompt ?? "-"}\nслова в сессию: ${JSON.stringify(oc.wordsTo("root"))}\nstderr:\n${oc.said()}`;
