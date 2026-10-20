/**
 * A fresh id for one save attempt. Sent with a payment so a double tap or a retried request
 * returns the payment already saved instead of recording it twice.
 */
export function newRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID needs a secure (HTTPS) page; fall back to random values elsewhere.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
