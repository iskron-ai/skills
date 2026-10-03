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
        "привязка записей цела, занятость — пока адрес не повернули connect-ом; слух здесь — iskron_stand без name встанет рядом на имя.N; отбить место (take=true) — только словом человека",
      `DOER: close ${code} — the seat was taken, another holder is listening; ` +
        "the write binding is intact, the seat stays occupied until the address is turned with connect; to listen here, iskron_stand without name stands beside on name.N; to retake the seat (take=true) — only on the human's word",
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
