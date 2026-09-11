export const NOT_SENT = "not-sent";
export const UNKNOWN = "unknown";
export type Outcome = typeof NOT_SENT | typeof UNKNOWN;

export type UpstreamKind = "network" | "auth" | "session" | "http";

export class UpstreamError extends Error {
  static readonly NOT_SENT: typeof NOT_SENT = NOT_SENT;
  static readonly UNKNOWN: typeof UNKNOWN = UNKNOWN;
  kind: UpstreamKind;
  // `presented` carries the access token the refused request actually used —
  // knowledge only the caller has. The store may have moved on since, and a
  // token a sibling has already replaced must not be blamed for this refusal.
  presented: string | null;
  // `outcome` says whether the request this error ends could ALREADY have taken
  // effect upstream. NOT_SENT — it never reached the server, so a retry is free.
  // UNKNOWN — it went out and the answer was lost, so a blind retry may write a
  // second time. Nothing between those two is honest, and saying neither is what
  // made "retry the call" dangerous: under one sentence lived both outcomes, and
  // the caller could not tell them apart. Witnessed: an update reported as failed
  // had applied, and the retry advised by that sentence collided with its own
  // first write.
  outcome: Outcome;
  // `retryable` marks a network failure worth another knock from the bridge
  // itself: a connection that failed outright. A timeout is not — it already
  // spent the whole deadline, and repeating it multiplies the wait.
  retryable: boolean;
  constructor(
    message: string,
    kind: UpstreamKind,
    presented: string | null = null,
    outcome: Outcome = UNKNOWN,
    retryable = false,
  ) {
    super(message);
    this.kind = kind;
    this.presented = presented;
    this.outcome = outcome;
    this.retryable = retryable;
  }
}

export class TokenError extends Error {
  oauthError: string | undefined;
  status: number;
  oauthMessage: string | undefined;
  constructor(
    message: string,
    oauthError: string | undefined,
    status: number,
    oauthMessage: string | undefined,
  ) {
    super(message);
    this.oauthError = oauthError;
    this.status = status;
    this.oauthMessage = oauthMessage;
  }
}

// Only these OAuth errors prove the grant itself is dead; anything else
// (network, 5xx, temporarily_unavailable) must NOT burn the refresh token
// or drag the user into the browser.
export const DEFINITIVE_OAUTH_ERRORS = new Set([
  "invalid_grant",
  "invalid_token",
  "invalid_client",
  "unauthorized_client",
]);

// The personal access token the bridge was given is refused by the server. No
// refresh, no browser, no wait repairs this: only a human with a new token.
export class TokenRefused extends Error {}

// `note` rides beside the link when the grant is whole and would come back by
// itself — the login offered instead of a wait, never a wait itself (#4794).
export class AuthPending extends Error {
  authorizeUrl: string;
  constructor(url: string, note?: string) {
    super(
      `authorization required — open in a browser: ${url}${note ? ` (${note})` : ""} — or give ` +
        `the bridge a personal access token instead (ISKRON_BRIDGE_TOKEN, or the file <auth-dir>/token)`,
    );
    this.authorizeUrl = url;
  }
}

// A refusal that clears itself by waiting: the grant is whole, the move simply
// did not happen yet. Collapsing this into "it failed" sends an agent fixing what
// only time fixes — so the KIND travels with the error to the verdict.
//
// The kind only, never a second copy of the wait: these messages already name
// their interval, measured on the SERVER's clock, and a verdict that recomputed
// one would put two different numbers on one refusal — the caller would believe
// the smaller and knock into the same wall.
export class HoldOffError extends Error {
  // retryNow marks the one flavor where an immediate retry is the honest move:
  // the FIRST early refusal of a needed refresh. The cooldown refusal and a
  // refusal that repeats both name waits that are real.
  retryNow: boolean;
  // When the hold ends, on the server-corrected clock — the refresh token's own
  // hour; null when nobody knows. A caller sits out a short one inside the call
  // and answers a long one with the login.
  until: number | null;
  constructor(message: string, retryNow = false, until: number | null = null) {
    super(message);
    this.retryNow = retryNow;
    this.until = until;
  }
}

// `expired` marks the one refusal that is proof by the grant's own hours: the
// refresh token's exp has passed, and no server hiccup ever looks like that.
export class DeadGrantError extends Error {
  expired: boolean;
  constructor(message: string, expired = false) {
    super(message);
    this.expired = expired;
  }
}

export function errorCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.cause?.code ?? err?.code;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
