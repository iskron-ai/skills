// Слова держателя сокета (граф @nks/nks-dev, узел #6080): то, что он говорит
// делателю и пишет причиной снятия.
import type { Lang } from "../lang.ts";
import { TAKE } from "./take.ts";

export interface HoldWords {
  newSocket: () => string;
  revokedOwn: () => string;
  /** Своё close канала — не мёртвый токен (#6634): connect не зовёт. */
  closedOwn: () => string;
  resumeFailed: () => string;
  tokenDead: () => string;
  parked: (reason: string) => string;
  evicted: (code: number) => string;
  /** Отнятое место другой сессии (#6706): держатель встаёт рядом сам, исход — следующим словом. */
  evictedBeside: (code: number, name: string, base: string) => string;
  besideDone: (name: string, said: string) => string;
  besideFailed: (name: string, base: string, said: string) => string;
  /** Вызов в граф отнятого места, пока мост не встал рядом. */
  evictedRefusal: (name: string, base: string) => string;
  /** Место другого графа на отнятом канале — встало ли снова на новом. */
  besideOther: (place: string, ok: boolean, said: string) => string;
  /** Место взял новый мост этой же сессии (перезапуск, компакшн): уступка без тревоги. */
  takenBySession: () => string;
  /** advice — совет о мёртвом токене (shared/channel.ts deadTokenAdvice). */
  dead: (advice: string) => string;
  alive: (version: string) => string;
}

export const HOLD: Readonly<Record<Lang, HoldWords>> = {
  ru: {
    newSocket: () => "новый сокет",
    revokedOwn: () => "снято своим revoke",
    closedOwn: () =>
      "канал закрыт своим close этой сессии — место отпущено, токен жив; встать снова — iskron_stand",
    resumeFailed: () => "возврат с диска не удался",
    tokenDead: () => "токен мёртв",
    parked: (reason) =>
      `мост ушёл с места (${reason}) — сокет закрыт, место цело; возврат — сторож или iskron_stand`,
    evicted: (code) =>
      `ДЕЛАТЕЛЬ: закрытие ${code} — место отняли, слушает другой держатель; ` +
      "записи в этот граф мост не отправит, пока не встанешь своим местом — его подписью они легли бы; слух здесь — iskron_stand без name встанет рядом на имя.N; " +
      `отбить место (take=true): ${TAKE.ru.rule()}`,
    evictedBeside: (code, name, base) =>
      `ДЕЛАТЕЛЬ: закрытие ${code} — место отняли (${name}), слушает другой держатель; его место не перехватываю и им не подписываюсь — встаю рядом на ${base}.N со слухом сам; исход — следующим словом, место и команду сторожа скажет iskron_stand тем же вызовом; вытеснить ту сессию (take=true): ${TAKE.ru.rule()}`,
    besideDone: (name, said) =>
      `Искрон: место ${name} отняли (4000) — мост встал рядом своим местом со слухом. ${said}`,
    besideFailed: (name, base, said) =>
      `Искрон: место ${name} отняли (4000), встать рядом мост не смог — слуха нет: ${said} Ход — iskron_stand с name=${base} без take: мост встанет рядом на ${base}.N со слухом.`,
    evictedRefusal: (name, base) =>
      `Отказано (мост): место ${name} отняли (4000), его слушает другой держатель, а встать рядом мост пока не смог — запись легла бы под его подписью; вызов не отправлен. Ход — iskron_stand с name=${base} без take: мост встанет рядом на ${base}.N со слухом; затем повтори вызов.`,
    besideOther: (place, ok, said) =>
      ok
        ? `Место другого графа ${place} было на отнятом канале — встало снова на новом. ${said}`
        : `Место другого графа ${place} было на отнятом канале и снова не встало — слуха там нет: ${said} Ход — iskron_stand в том графе тем же именем.`,
    takenBySession: () =>
      "место взял новый мост этой же сессии — этот экземпляр отпускает сокет, слух — у нового",
    dead: (advice) => `ДЕЛАТЕЛЬ: ${advice}`,
    alive: (version) =>
      `ДЕЛАТЕЛЬ: сокет рвут, а служба отвечает (${version}) — место держу, переоткрываю реже; ` +
      "не пройдёт — спроси о токене",
  },
  en: {
    newSocket: () => "new socket",
    revokedOwn: () => "revoked by this session",
    closedOwn: () =>
      "the channel was closed by this session's own close — the seat is released, the token is alive; to stand again — iskron_stand",
    resumeFailed: () => "resume from disk failed",
    tokenDead: () => "token dead",
    parked: (reason) =>
      `the bridge left the seat (${reason}) — socket closed, seat intact; to return use the watchdog or iskron_stand`,
    evicted: (code) =>
      `DOER: close ${code} — the seat was taken, another holder is listening; ` +
      "the bridge sends no writes into this graph until you stand on your own seat — they would go under its signature; to listen here, iskron_stand without name stands beside on name.N; " +
      `to retake the seat (take=true): ${TAKE.en.rule()}`,
    evictedBeside: (code, name, base) =>
      `DOER: close ${code} — the seat ${name} was taken, another holder is listening; not taking it over and not signing with it — standing beside as ${base}.N with hearing myself; the outcome comes next, iskron_stand with the same call tells the seat and the watchdog command; evicting that session (take=true): ${TAKE.en.rule()}`,
    besideDone: (name, said) =>
      `Iskron: the seat ${name} was taken (4000) — the bridge stood beside on its own seat with hearing. ${said}`,
    besideFailed: (name, base, said) =>
      `Iskron: the seat ${name} was taken (4000), and the bridge could not stand beside — no hearing: ${said} The move — iskron_stand with name=${base} without take: the bridge stands beside as ${base}.N with hearing.`,
    evictedRefusal: (name, base) =>
      `Refused (bridge): the seat ${name} was taken (4000), another holder listens on it, and the bridge could not stand beside yet — the write would go under its signature; the call was not sent. The move — iskron_stand with name=${base} without take: the bridge stands beside as ${base}.N with hearing; then repeat the call.`,
    besideOther: (place, ok, said) =>
      ok
        ? `The seat of another graph ${place} was on the taken channel — it stands again on the new one. ${said}`
        : `The seat of another graph ${place} was on the taken channel and did not stand again — no hearing there: ${said} The move — iskron_stand in that graph with the same name.`,
    takenBySession: () =>
      "a new bridge of this same session took the seat — this instance lets the socket go, the hearing is the new one's",
    dead: (advice) => `DOER: ${advice}`,
    alive: (version) =>
      `DOER: the socket keeps being cut while the service answers (${version}) — holding the seat, reopening less often; ` +
      "if it fails, ask about the token",
  },
};
