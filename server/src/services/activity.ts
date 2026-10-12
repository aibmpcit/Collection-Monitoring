import { query } from "../config/db.js";

export type ActivityKind = "login" | "visit" | "heartbeat";

export const HEARTBEAT_SECONDS = 60;

// One row per user per day keeps tracking compact. Heartbeats arriving faster than
// the client interval (extra tabs, replays) do not add screen time.
const updates: Record<ActivityKind, string> = {
  login: "logins = logins + 1, last_seen_at = NOW()",
  visit: "visits = visits + 1, last_seen_at = NOW()",
  heartbeat: `screen_seconds = screen_seconds + IF(last_seen_at IS NULL OR last_seen_at <= NOW() - INTERVAL ${HEARTBEAT_SECONDS - 10} SECOND, ${HEARTBEAT_SECONDS}, 0),
    last_seen_at = NOW()`
};

export async function recordActivity(userId: number, kind: ActivityKind) {
  await query(
    `INSERT INTO user_activity_daily (user_id, day, logins, visits, screen_seconds, last_seen_at)
     VALUES ($1, CURRENT_DATE, $2, $3, $4, NOW())
     ON DUPLICATE KEY UPDATE ${updates[kind]}`,
    [userId, kind === "login" ? 1 : 0, kind === "visit" ? 1 : 0, kind === "heartbeat" ? HEARTBEAT_SECONDS : 0]
  );
}
