// A login is the one repair that costs a human their attention, so it is spent
// last and not twice. Two waits stand between a refused grant and the browser:
// a refusal must PERSIST (a single one can be the server mid-restart, a clock
// skew, a token not yet in force), and a login already offered and declined is
// not offered again at once — a person who said no meant it for more than the
// four seconds until the next tool call.
export const LOGIN_GRACE_MS = 120_000;
export const LOGIN_SNOOZE_MS = 10 * 60_000;
