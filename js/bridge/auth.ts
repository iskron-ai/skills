import { now } from "./clock.ts";
import { CFG } from "./config.ts";
import { DeadGrantError, errorMessage, TokenRefused } from "./errors.ts";
import { discover } from "./oauth/discovery.ts";
import { interactiveFlow } from "./oauth/flow.ts";
import { holdOffLogin, refreshShared, refusalStands } from "./oauth/refresh.ts";
import { loadStore } from "./store.ts";
import { debug, log } from "./streams.ts";
import { refreshHours, tokenUsable } from "./tokens.ts";
import { type Tokens } from "./types.ts";

export interface AuthOptions {
  /** ignore the cached access token (after an upstream 401) */
  force?: boolean;
  /** the token upstream actually refused, when the caller knows */
  rejected?: string | null;
  /** false forbids the browser (background keepalive) */
  interactive?: boolean;
  /** a top-up the caller does not actually need yet */
  proactive?: boolean;
}

let authInFlight: { promise: Promise<Tokens>; interactive: boolean } | null = null;

// Returns fresh-enough tokens. Order: cached access token -> silent refresh ->
// (only if allowed and the grant is definitively dead) the browser flow.
export async function ensureAuth(
  wwwAuthenticate: string | null,
  opts: AuthOptions = {},
): Promise<Tokens> {
  const { force = false, interactive = true, proactive = false } = opts;
  if (CFG.pat) {
    // A PAT is the whole grant: there is nothing to refresh and nobody to send
    // to a browser. Being here at all means the server refused it.
    throw new TokenRefused(
      `the personal access token from ${CFG.patSource} is refused by the server — revoked, ` +
        `expired or without rights to this graph; mint a new one on the graph's token page and ` +
        `put it in ${CFG.patSource}`,
    );
  }
  if (authInFlight) {
    // A background (non-interactive) attempt must not stand in for a caller
    // that is allowed to open the browser: await it, and if it could not
    // finish the job, run our own interactive round.
    if (!interactive || authInFlight.interactive) return authInFlight.promise;
    await authInFlight.promise.catch(() => {});
    if (authInFlight) return authInFlight.promise; // someone else already restarted it
    const s = loadStore();
    if (tokenUsable(s.tokens)) return s.tokens;
  }
  const promise = (async () => {
    try {
      const s = loadStore();
      // force says the token we came with is no answer — upstream refused it
      // (401) or the keepalive found it about to expire. WHICH token that was
      // is what makes a sibling's newer one recognisable as progress, so a
      // caller that knows says so; only the keepalive, replacing whatever is on
      // disk, may take the store's word for it.
      const rejected = opts.rejected ?? (force ? (s.tokens?.access_token ?? null) : null);
      if (!force && tokenUsable(s.tokens)) return s.tokens;
      const meta = s.meta?.as ? s.meta : await discover(wwwAuthenticate);
      // Discovery runs once and its result is cached in the store, so an
      // override set later would never be seen — and the operator setting one
      // is, by definition, doing it AFTER a flow already ran and produced the
      // wrong audience. Apply it here, where the value is used, not only where
      // it is discovered.
      if (CFG.resource) meta.resource = CFG.resource;
      if (s.tokens?.refresh_token) {
        try {
          return await refreshShared(meta, rejected, proactive, interactive);
        } catch (e) {
          // Anything but a dead grant is transient. Dead grants were recorded
          // while holding the refresh lock, before a sibling can follow them.
          if (!(e instanceof DeadGrantError)) throw e;
          if (!interactive) {
            throw new Error("authorization required (refresh grant dead, browser flow deferred)", {
              cause: e,
            });
          }
          holdOffLogin(e.message, e.expired); // may decide the human is not to be asked yet
          log(`refresh grant is dead (${e.message}) — starting a fresh authorization`);
          return await interactiveFlow(meta);
        }
      }
      if (!interactive)
        throw new Error("authorization required (no tokens, browser flow deferred)");
      return await interactiveFlow(meta);
    } finally {
      authInFlight = null;
    }
  })();
  authInFlight = { promise, interactive };
  return promise;
}

// Keep the grant alive even when the harness makes no MCP calls: refresh the
// access token shortly before expiry, rotating the refresh token with it, so
// an idle session never decays into a dead grant and a surprise browser trip.
//
// The margin is a wish, not a right: a refresh token held back until the access
// token is nearly spent (nbf) cannot be used early however much time the margin
// would like. Asking anyway buys nothing and spends a refusal, so the keepalive
// waits for the later of the two hours.
const REFRESH_MARGIN_MS = 3 * 60_000;

export function startTokenKeepalive(): void {
  if (CFG.pat) return; // a PAT has no hour to keep
  const tick = () => {
    const t = loadStore().tokens;
    if (!t?.refresh_token) return;
    const expiresAt = t.expires_at || 0;
    if (!expiresAt || expiresAt - now() >= REFRESH_MARGIN_MS) return;
    const hours = refreshHours(t);
    if (hours.nbf && now() < hours.nbf) {
      debug(
        `refresh token not in force for another ${Math.round((hours.nbf - now()) / 1000)}s — waiting`,
      );
      return;
    }
    if (hours.exp && now() >= hours.exp) {
      debug("the grant is past its own expiry — only a human can mend it now");
      return; // spending refusals on a grant whose hour has passed teaches nobody anything
    }
    if (refusalStands()) {
      debug("the grant stands refused — the machine's control knock is not due yet");
      return;
    }
    ensureAuth(null, { force: true, interactive: false, proactive: true })
      .then(() => debug("background token refresh ok"))
      .catch((e) => log(`background token refresh: ${errorMessage(e)}`));
  };
  tick(); // an already-expired store refreshes on startup, before the first call
  setInterval(tick, 60_000).unref();
}
