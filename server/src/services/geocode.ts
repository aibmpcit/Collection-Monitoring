// Turns coordinates into a readable place (barangay, town, province) for field evidence.
// Uses OpenStreetMap Nominatim: one request per second at most, identified with a User-Agent,
// and cached by rounded coordinates, per its usage policy. Set GEOCODER=off to disable.

export interface Place {
  barangay: string;
  town: string;
  province: string;
  /** e.g. "Brgy. Centro Norte, Culasi, Antique" */
  label: string;
}

const ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const MIN_INTERVAL_MS = 1100;
const TIMEOUT_MS = 6000;
const MAX_CACHE = 5000;

const cache = new Map<string, Place | null>();
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

export function geocoderEnabled() {
  return (process.env.GEOCODER ?? "on").toLowerCase() !== "off";
}

/** Builds the place from a Nominatim address. In the Philippines the barangay usually comes back as "village" (towns) or "suburb"/"quarter" (cities). */
export function placeFromAddress(address: Record<string, string> | undefined): Place | null {
  if (!address) return null;
  const barangay = address.village || address.suburb || address.quarter || address.neighbourhood || address.hamlet || "";
  const town = address.town || address.city || address.municipality || "";
  const province = address.province || address.state || address.county || "";
  if (!barangay && !town) return null;
  const parts = [barangay ? `Brgy. ${barangay.replace(/^(brgy\.?|barangay)\s+/i, "")}` : "", town, province].filter(Boolean);
  return { barangay, town, province, label: parts.join(", ") };
}

async function fetchPlace(latitude: number, longitude: number): Promise<Place | null> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  const url = `${ENDPOINT}?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=${latitude}&lon=${longitude}`;
  const contact = process.env.GEOCODER_CONTACT?.trim();
  const response = await fetch(url, {
    headers: { "User-Agent": `BMPC-Collection-Monitoring/1.0${contact ? ` (${contact})` : ""}` },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Geocoder responded ${response.status}`);
  const body = await response.json() as { address?: Record<string, string> };
  return placeFromAddress(body.address);
}

/** The place at these coordinates, or null when unknown. Throws when the service can't be reached. */
export async function reverseGeocode(latitude: number, longitude: number): Promise<Place | null> {
  // ~11 m grid: nearby fixes share a lookup.
  const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  const request = queue.then(() => fetchPlace(latitude, longitude));
  queue = request.catch(() => undefined);
  const place = await request;
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(key, place);
  return place;
}

export function clearGeocodeCache() {
  cache.clear();
}
