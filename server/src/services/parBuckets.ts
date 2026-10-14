// PAR age groupings shared by the Collections filter and the Reports PAR table.
export const PAR_BUCKETS = [
  { key: "current", label: "Current (0)", min: 0, max: 0 },
  { key: "1-30", label: "PAR 1-30", min: 1, max: 30 },
  { key: "31-60", label: "PAR 31-60", min: 31, max: 60 },
  { key: "61-90", label: "PAR 61-90", min: 61, max: 90 },
  { key: "91-180", label: "PAR 91-180", min: 91, max: 180 },
  { key: "181-365", label: "PAR 181-365", min: 181, max: 365 },
  { key: "over-365", label: "PAR over 365", min: 366, max: null }
] as const;

export type ParBucketKey = typeof PAR_BUCKETS[number]["key"];
export const PAR_BUCKET_KEYS = PAR_BUCKETS.map(bucket => bucket.key) as [ParBucketKey, ...ParBucketKey[]];

/** SQL CASE that labels a loan (aliased `l`) with its PAR bucket key. */
export const parBucketSql = `CASE ${PAR_BUCKETS.map(bucket => bucket.max === null
  ? `WHEN l.par_age >= ${bucket.min} THEN '${bucket.key}'`
  : `WHEN l.par_age BETWEEN ${bucket.min} AND ${bucket.max} THEN '${bucket.key}'`).join(" ")} ELSE 'current' END`;

/** SQL condition matching loans (aliased `l`) in one PAR bucket. Bucket bounds are constants, not input. */
export function parBucketCondition(key: ParBucketKey) {
  const bucket = PAR_BUCKETS.find(item => item.key === key)!;
  return bucket.max === null ? `l.par_age >= ${bucket.min}` : `l.par_age BETWEEN ${bucket.min} AND ${bucket.max}`;
}
