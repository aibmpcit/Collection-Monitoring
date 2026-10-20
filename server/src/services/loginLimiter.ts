// Failed sign-ins are limited per username (stops guessing one account from many addresses)
// and, when the client address is trustworthy, per IP (stops one address trying many accounts).
// Counters live in memory and, once useDatabaseLoginStore() runs at startup, are also saved in the
// database, so a restart or redeploy doesn't wipe them.
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES_PER_USERNAME = 10;
const MAX_FAILURES_PER_IP = 30;
const MAX_TRACKED_KEYS = 10_000;

interface Bucket { failures: number; resetAt: number }
const buckets = new Map<string, Bucket>();

interface LoginStore {
  save(key: string, bucket: Bucket): Promise<unknown>;
  remove(key: string): Promise<unknown>;
}
let store: LoginStore | null = null;

function persist(key: string) {
  if (!store) return;
  const bucket = buckets.get(key);
  // Saving must never block or fail a sign-in.
  (bucket ? store.save(key, bucket) : store.remove(key)).catch(error =>
    console.error("Unable to save sign-in limit", error instanceof Error ? error.message : error));
}

/** Loads saved counters and saves future changes to the login_failures table. */
export async function useDatabaseLoginStore(now = Date.now()) {
  const { query } = await import("../config/db.js");
  await query(`CREATE TABLE IF NOT EXISTS login_failures (
    bucket_key VARCHAR(191) NOT NULL,
    failures INT UNSIGNED NOT NULL,
    reset_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (bucket_key)
  ) ENGINE=InnoDB`);
  await query("DELETE FROM login_failures WHERE reset_at <= $1", [now]);
  const saved = await query<{ bucket_key: string; failures: number; reset_at: number }>("SELECT bucket_key, failures, reset_at FROM login_failures");
  for (const row of saved.rows) buckets.set(row.bucket_key, { failures: Number(row.failures), resetAt: Number(row.reset_at) });
  store = {
    save: (key, bucket) => query(
      `INSERT INTO login_failures (bucket_key, failures, reset_at) VALUES ($1, $2, $3)
       ON DUPLICATE KEY UPDATE failures = VALUES(failures), reset_at = VALUES(reset_at)`, [key, bucket.failures, bucket.resetAt]),
    remove: key => query("DELETE FROM login_failures WHERE bucket_key = $1", [key])
  };
}

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
    persist(key);
  }
}

export function recordLoginSuccess(username: string) {
  const key = `user:${username.trim().toLowerCase()}`;
  buckets.delete(key);
  persist(key);
}

/** Clears the counters and stops saving them (tests). */
export function resetLoginLimiter() {
  buckets.clear();
  store = null;
}
