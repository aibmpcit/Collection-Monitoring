// Field photos for remarks: the phone's location at capture time is the geotag. Browsers usually
// strip GPS data from camera uploads, so it is read from the device instead, saved with the
// remark, and also stamped onto the image so the proof travels with the file.

export interface GeoFix {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface CapturedPhoto {
  name: string;
  type: "image/jpeg";
  data: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  /** Device wall-clock time, "YYYY-MM-DDTHH:mm:ss". */
  capturedAt: string;
  /** For previews only; never sent to the server. */
  previewUrl: string;
  locationError: string;
}

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;

const pad = (value: number) => String(value).padStart(2, "0");

export function wallClock(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatCoordinates(fix: Pick<GeoFix, "latitude" | "longitude"> & { accuracy?: number | null }) {
  const base = `${fix.latitude.toFixed(6)}, ${fix.longitude.toFixed(6)}`;
  return fix.accuracy != null ? `${base} (±${Math.round(fix.accuracy)} m)` : base;
}

export function mapLink(latitude: number, longitude: number) {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

/** Current position, or a readable reason why it is unavailable. */
export function getCurrentLocation(timeoutMs = 15000): Promise<{ fix: GeoFix | null; error: string }> {
  return new Promise(resolve => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ fix: null, error: "This device can't share its location." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position => resolve({
        fix: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy },
        error: ""
      }),
      failure => resolve({
        fix: null,
        error: failure.code === failure.PERMISSION_DENIED
          ? "Location permission was denied. Allow location for this site to geotag photos."
          : failure.code === failure.TIMEOUT ? "Couldn't get a location fix in time. Try again in an open area." : "Location is unavailable."
      }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 }
    );
  });
}

async function loadImage(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      // Respects the photo's rotation so portrait shots are not drawn sideways.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall back to an <img> below.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("This file is not an image the browser can read."));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function stamp(context: CanvasRenderingContext2D, width: number, height: number, lines: string[]) {
  const fontSize = Math.max(14, Math.round(width / 45));
  const padding = Math.round(fontSize * 0.6);
  const lineHeight = Math.round(fontSize * 1.3);
  const barHeight = padding * 2 + lineHeight * lines.length;
  context.fillStyle = "rgba(0, 0, 0, 0.55)";
  context.fillRect(0, height - barHeight, width, barHeight);
  context.fillStyle = "#ffffff";
  context.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  context.textBaseline = "top";
  lines.forEach((line, index) => context.fillText(line, padding, height - barHeight + padding + index * lineHeight));
}

/** Shrinks the photo, stamps time and location on it, and returns it ready to upload. */
export async function prepareGeotaggedPhoto(file: File, location: { fix: GeoFix | null; error: string }, takenAt = new Date()): Promise<CapturedPhoto> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a photo.");
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to process the photo on this device.");
  context.drawImage(image, 0, 0, width, height);
  const capturedAt = wallClock(takenAt);
  stamp(context, width, height, [
    takenAt.toLocaleString(),
    location.fix ? formatCoordinates(location.fix) : "Location unavailable"
  ]);
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return {
    name: `remark-photo-${capturedAt.replace(/\D/g, "")}.jpg`,
    type: "image/jpeg",
    data: dataUrl.split(",")[1] ?? "",
    latitude: location.fix?.latitude ?? null,
    longitude: location.fix?.longitude ?? null,
    accuracy: location.fix ? Math.round(location.fix.accuracy) : null,
    capturedAt,
    previewUrl: dataUrl,
    locationError: location.error
  };
}

/** What the server stores; the preview stays in the browser. */
export function photoPayload(photo: CapturedPhoto | null | undefined) {
  if (photo === undefined) return undefined;
  if (photo === null) return null;
  const { previewUrl: _preview, locationError: _error, ...payload } = photo;
  return payload;
}
