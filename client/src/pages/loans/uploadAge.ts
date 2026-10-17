// Managers upload each branch's overdue list once a week, so a list older than that is due for a refresh.
export const UPLOAD_INTERVAL_DAYS = 7;

/** Whole calendar days between an upload ("YYYY-MM-DD HH:MM:SS") and today; null when the date can't be read. */
export function daysSinceUpload(uploadedAt: string, today = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(uploadedAt);
  if (!match) return null;
  const uploaded = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const current = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((current - uploaded) / 86_400_000));
}

/** Warning to show when the latest list is past its weekly upload, otherwise "". */
export function weeklyUploadWarning(uploadedAt: string, today = new Date()) {
  const days = daysSinceUpload(uploadedAt, today);
  if (days === null || days <= UPLOAD_INTERVAL_DAYS) return "";
  return `Last upload was ${days} days ago. The weekly list is due, so PAR ages and settled accounts may be out of date.`;
}
