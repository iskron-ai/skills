// The probe's clock for a bridge child (NODE_OPTIONS=--require): Date.now runs
// FAST_CLOCK times faster from the process's start, so a wait the bridge counts by
// Date.now (a 429's Retry-After, standmoves.ts awaitReissue) passes in a tenth of the time.
const fast = Number(process.env.FAST_CLOCK) || 10;
const realNow = Date.now.bind(Date);
const start = realNow();
Date.now = () => start + (realNow() - start) * fast;
