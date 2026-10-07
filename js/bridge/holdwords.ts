// Слова держателя сокета (граф nks-dev: #6080): то, что он говорит делателю и пишет причиной снятия.
import { deadTokenAdvice } from "../shared/channel.ts";
import { L } from "../shared/lang.ts";

export const holdWords = {
  newSocket: () => L("новый сокет", "new socket"),
  revokedOwn: () => L("снято своим revoke", "revoked by this session"),
  /** Своё close канала — не мёртвый токен (#6634): одно слово на обоих языках, connect не зовёт. */
  closedOwn: () =>
    L(
      "канал закрыт своим close этой сессии — место отпущено, токен жив; встать снова — iskron_stand",
      "the channel was closed by this session's own close — the seat is released, the token is alive; to stand again — iskron_stand",
    ),
  resumeFailed: () => L("возврат с диска не удался", "resume from disk failed"),
  tokenDead: () => L("токен мёртв", "token dead"),
  parked: (reason: string) =>
    L(
      `мост ушёл с места (${reason}) — сокет закрыт, место цело; возврат — сторож или iskron_stand`,
      `the bridge left the seat (${reason}) — socket closed, seat intact; to return use the watchdog or iskron_stand`,
    ),
  evicted: (code: number) =>
    L(
      `ДЕЛАТЕЛЬ: закрытие ${code} — место отняли, слушает другой держатель; ` +
        "записи в этот граф мост не отправит, пока не встанешь своим местом — его подписью они легли бы; слух здесь — iskron_stand без name встанет рядом на имя.N; отбить место (take=true) — только словом человека",
      `DOER: close ${code} — the seat was taken, another holder is listening; ` +
        "the bridge sends no writes into this graph until you stand on your own seat — they would go under its signature; to listen here, iskron_stand without name stands beside on name.N; to retake the seat (take=true) — only on the human's word",
    ),
  /** Отнятое место другой сессии (#6706): держатель встаёт рядом сам, исход — следующим словом. */
  evictedBeside: (code: number, name: string, base: string) =>
    L(
      `ДЕЛАТЕЛЬ: закрытие ${code} — место отняли (${name}), слушает другой держатель; его место не перехватываю и им не подписываюсь — встаю рядом на ${base}.N со слухом сам; исход — следующим словом, место и команду сторожа скажет iskron_stand тем же вызовом; вытеснить ту сессию (take=true) — только словом человека`,
      `DOER: close ${code} — the seat ${name} was taken, another holder is listening; not taking it over and not signing with it — standing beside as ${base}.N with hearing myself; the outcome comes next, iskron_stand with the same call tells the seat and the watchdog command; evicting that session (take=true) — only on the human's word`,
    ),
  besideDone: (name: string, said: string) =>
    L(
      `Искрон: место ${name} отняли (4000) — мост встал рядом своим местом со слухом. ${said}`,
      `Iskron: the seat ${name} was taken (4000) — the bridge stood beside on its own seat with hearing. ${said}`,
    ),
  besideFailed: (name: string, base: string, said: string) =>
    L(
      `Искрон: место ${name} отняли (4000), встать рядом мост не смог — слуха нет: ${said} Ход — iskron_stand с name=${base} без take: мост встанет рядом на ${base}.N со слухом.`,
      `Iskron: the seat ${name} was taken (4000), and the bridge could not stand beside — no hearing: ${said} The move — iskron_stand with name=${base} without take: the bridge stands beside as ${base}.N with hearing.`,
    ),
  /** Вызов в граф отнятого места, пока мост не встал рядом. */
  evictedRefusal: (name: string, base: string) =>
    L(
      `Отказано (мост): место ${name} отняли (4000), его слушает другой держатель, а встать рядом мост пока не смог — запись легла бы под его подписью; вызов не отправлен. Ход — iskron_stand с name=${base} без take: мост встанет рядом на ${base}.N со слухом; затем повтори вызов.`,
      `Refused (bridge): the seat ${name} was taken (4000), another holder listens on it, and the bridge could not stand beside yet — the write would go under its signature; the call was not sent. The move — iskron_stand with name=${base} without take: the bridge stands beside as ${base}.N with hearing; then repeat the call.`,
    ),
  /** Место другого графа на отнятом канале — встало ли снова на новом. */
  besideOther: (place: string, ok: boolean, said: string) =>
    ok
      ? L(
          `Место другого графа ${place} было на отнятом канале — встало снова на новом. ${said}`,
          `The seat of another graph ${place} was on the taken channel — it stands again on the new one. ${said}`,
        )
      : L(
          `Место другого графа ${place} было на отнятом канале и снова не встало — слуха там нет: ${said} Ход — iskron_stand в том графе тем же именем.`,
          `The seat of another graph ${place} was on the taken channel and did not stand again — no hearing there: ${said} The move — iskron_stand in that graph with the same name.`,
        ),
  /** Место взял новый мост этой же сессии (перезапуск, компакшн): уступка без тревоги. */
  takenBySession: () =>
    L(
      "место взял новый мост этой же сессии — этот экземпляр отпускает сокет, слух — у нового",
      "a new bridge of this same session took the seat — this instance lets the socket go, the hearing is the new one's",
    ),
  dead: (code: number) => L(`ДЕЛАТЕЛЬ: ${deadTokenAdvice(code)}`, `DOER: ${deadTokenAdvice(code)}`),
  alive: (version: string) =>
    L(
      `ДЕЛАТЕЛЬ: сокет рвут, а служба отвечает (${version}) — место держу, переоткрываю реже; ` +
        "не пройдёт — спроси о токене",
      `DOER: the socket keeps being cut while the service answers (${version}) — holding the seat, reopening less often; ` +
        "if it fails, ask about the token",
    ),
};
