// Мосты дочерних сессий половины «тулы» (tools.ts): свой мост на стояние ребёнка
// (#5154, спутник места корня — #6002) и возврат ведущего субагента после
// перезагрузки плагина (#6625; #6550, правило 3). Плагин, которого останавливают,
// ставит держащие мосты детей на паузу (`iskron/suspend`, bridge/suspend.ts):
// место-спутник, дела и занятость ждут; ключ места, место корня, дело поручения и
// сказанный родителю ход уходят в маркер потери (keep.ts). Новый экземпляр поднимает
// ребёнку мост тем же спутником и возвращает место по ключу — без слова ребёнку: его сессия ждёт дальше;
// связка с родителем — parentID сессии (leads.ts). Не вернулось — конец со словом родителю.
import { envName } from "../delivery/index.ts";
import { sleep } from "./bridge-io.ts";
import type { Keeper } from "./keep.ts";
import type { Leads } from "./leadwords.ts";
import type { LostEntry } from "./records.ts";
import type { Slot } from "./tools.ts";
import { handedOver } from "./twins.ts";

/**
 * Возврат места ребёнка ждёт ухода сокета прежнего моста (он уходит своим bye) до
 * BACK_MS — не счётом попыток (keep.ts); попытки — только на иные сбои возврата.
 */
const BACK_MS = Number(process.env[envName("CHILD_BACK_MS")]) || 15_000;
const BACK_TRIES = 4;
const BACK_PAUSE_MS = Number(process.env[envName("CHILD_BACK_PAUSE_MS")]) || 1_000;
/** Пауза моста ребёнка перед остановкой плагина — не дольше этого. */
export const PAUSE_MS = 1_500;

export interface ChildDoors {
  slots: Map<string, Slot>;
  spawn(args: string[]): Slot;
  keeper: Keeper<Slot>;
  leads: Leads;
  exists(session: string): Promise<boolean>;
  /** Прогон ребёнка кончен: расход — мосту, мост гасится (live), запись мостом корня — отказ (#6361). */
  endRun(session: string, live?: boolean): void;
}

export function createChildren(d: ChildDoors) {
  const coming = new Map<string, Promise<unknown>>(); // дети маркера, чей слот ещё встаёт
  /**
   * Мост дочерней сессии для её собственного стояния — один на сессию: живой
   * возвращается, умерший заменяется с его памятью о месте; участок get→set
   * синхронен, и два стоячих вызова одной пачки берут один мост, не два.
   * Место с диска по каталогу ребёнку не возвращается (он встаёт сейчас);
   * возврат по имени внутри iskron_stand — как у всякого моста. back — запись
   * маркера прежнего экземпляра: память о месте берётся из неё, возврат молчит.
   */
  function childSlot(sessionID: string, parent?: Slot | null, back?: LostEntry): Slot {
    const have = d.slots.get(sessionID);
    if (have && !have.bridge.failure) return have;
    const was =
      have ?? (back && { satelliteOf: back.of, dir: back.dir, key: back.key, stood: true });
    // Корень держит место — мост ребёнка его спутник (satellite.ts); не держит — как прежде.
    const of = was?.satelliteOf ?? parent?.place ?? null;
    const own = d.spawn(of ? ["--satellite"] : []);
    own.satelliteOf = of;
    own.session = sessionID;
    own.child = true;
    own.dir = was?.dir ?? null;
    own.key = was?.key ?? null;
    d.slots.set(sessionID, own);
    // Замена умершего детского моста возвращает его место сразу, по ключу из
    // «held», а не ждёт такта сторожа: записи ребёнка в этом окне шли бы
    // безавторными. Без ключа возвращать нечем — ребёнок встанет заново.
    if (was?.stood && own.key)
      own.resume = d.keeper
        .resume(own, sessionID, !!back, back ? BACK_MS : undefined)
        .finally(() => (own.resume = null));
    return own;
  }

  /** Ребёнок прежнего экземпляра: тот же спутник, место по ключу; не вернулось — конец. */
  async function back(e: LostEntry): Promise<void> {
    // Не спутник — не ведущий (#6550 п.4): его прогон кончился с прежним экземпляром.
    if (!e.of) return d.endRun(e.session, false);
    d.leads.back(e.session, e);
    // Вызов ребёнка, пришедший раньше его слота, ждёт его (coming), а не уходит мостом
    // корня с отказом «место родителя неизвестно» (astra, 7.2.6).
    const ready = (async () => {
      // Сессия не читается (удалена или сбой get) — ребёнок кончен: его запись иначе
      // пошла бы мостом корня (#6361); место уйдёт сроком канала, родителю — слово, если он известен.
      if (!(await d.exists(e.session)))
        return void (await d.leads.fail(
          e.session,
          "перезагрузка плагина, сессия субагента не читается",
        ));
      if (!e.key)
        return void (await d.leads.fail(e.session, "перезагрузка плагина, ключа места нет"));
      return childSlot(e.session, null, e);
    })();
    coming.set(e.session, ready);
    const own = await ready.finally(() => coming.delete(e.session));
    if (!own) return;
    for (let i = 0; i < BACK_TRIES && !own.holding; i++) {
      if (i) {
        await sleep(BACK_PAUSE_MS);
        own.resume = d.keeper
          .resume(own, e.session, true, BACK_MS)
          .finally(() => (own.resume = null));
      }
      if ((await own.resume) === "elsewhere") break; // сокет прежнего моста не ушёл и за срок
    }
    if (!own.holding)
      await d.leads.fail(e.session, "перезагрузка плагина, место-спутник по ключу не вернулось");
  }

  /** Остановка плагина: держащие мосты детей — на паузу, их место и дела ждут нового экземпляра. */
  async function pause(): Promise<void> {
    const held = [...d.slots.values()].filter(
      (s) => s.child && s.satelliteOf && s.holding && s.session,
    );
    for (const s of held) {
      const was = d.leads.snapshot(s.session as string);
      [s.room, s.noted, s.last] = [was.room, was.noted, was.last];
    }
    await Promise.all(
      held.map((s) =>
        s.bridge
          .request("iskron/suspend", {}, { timeoutMs: PAUSE_MS, service: true })
          .catch(() => {}),
      ),
    );
  }

  /** Слот ребёнка маркера встаёт — дождаться (ошибки — не здесь). */
  const settled = async (session: string): Promise<unknown> => {
    await handedOver(session); // спутник ребёнка ещё едет сюда из прежней папки (handoff.ts)
    return coming.get(session)?.catch(() => {});
  };

  return { childSlot, back, pause, settled };
}
