// Failed sign-ins are limited per username (stops guessing one account from many addresses)
// and, when the client address is trustworthy, per IP (stops one address trying many accounts).
// Kept in memory, so limits reset when the server restarts; the app runs as a single process.
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES_PER_USERNAME = 10;
const MAX_FAILURES_PER_IP = 30;
const MAX_TRACKED_KEYS = 10_000;

interface Bucket { failures: number; resetAt: number }
const buckets = new Map<string, Bucket>();

// Without a known client address (behind a proxy with TRUST_PROXY unset) every visitor shares the
// proxy's address, so an IP limit would let one person lock everyone out; only usernames count then.
function keys(username: string, ip?: string) {
  const tracked = [{ key: `user:${username.trim().toLowerCase()}`, max: MAX_FAILURES_PER_USERNAME }];
  if (ip) tracked.push({ key: `ip:${ip}`, max: MAX_FAILURES_PER_IP });
  return tracked;
}

function current(key: string, now: number) {
  const bucket = buckets.get(key);
  if (bucket && bucket.resetAt <= now) {
    buckets.delete(key);
    return undefined;
  }
  return bucket;
}

/** Seconds until the caller may try again, or 0 when the attempt is allowed. */
export function loginRetryAfter(username: string, ip: string | undefined, now = Date.now()) {
  let wait = 0;
  for (const { key, max } of keys(username, ip)) {
    const bucket = current(key, now);
    if (bucket && bucket.failures >= max) wait = Math.max(wait, Math.ceil((bucket.resetAt - now) / 1000));
  }
  return wait;
}

export function recordLoginFailure(username: string, ip: string | undefined, now = Date.now()) {
  if (buckets.size >= MAX_TRACKED_KEYS) {
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
    // Still full (a flood of made-up usernames): drop the oldest entries so memory stays bounded.
    for (const key of buckets.keys()) {
      if (buckets.size < MAX_TRACKED_KEYS) break;
      buckets.delete(key);
    }
  }
  for (const { key } of keys(username, ip)) {
    const bucket = current(key, now);
    if (bucket) bucket.failures += 1;
    else buckets.set(key, { failures: 1, resetAt: now + WINDOW_MS });
  }
}

export function recordLoginSuccess(username: string) {
  buckets.delete(`user:${username.trim().toLowerCase()}`);
}

export function resetLoginLimiter() {
  buckets.clear();
}
