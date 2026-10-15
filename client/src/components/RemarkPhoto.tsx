import { Camera, MapPin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiBlobUrl } from "../services/api";
import { formatCoordinates, getCurrentLocation, mapLink, prepareGeotaggedPhoto, type CapturedPhoto } from "../services/photo";

export interface RemarkPhotoInfo {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  capturedAt: string;
}

/**
 * Camera button for a remark form. `photo` is undefined while untouched (an existing photo is
 * kept), null when the user removed it, or the newly taken photo.
 */
export function RemarkPhotoField({ photo, hasExisting, onChange, disabled = false }: {
  photo: CapturedPhoto | null | undefined;
  hasExisting: boolean;
  onChange: (photo: CapturedPhoto | null | undefined) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [inputKey, setInputKey] = useState(0);
  // Location starts when the camera opens, so the fix is usually ready once the photo is taken.
  const locationRequest = useRef<ReturnType<typeof getCurrentLocation> | null>(null);

  async function handleFile(file: File | undefined) {
    setInputKey(key => key + 1);
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const location = await (locationRequest.current ?? getCurrentLocation());
      onChange(await prepareGeotaggedPhoto(file, location));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to use this photo.");
    } finally {
      locationRequest.current = null;
      setBusy(false);
    }
  }

  const showExisting = hasExisting && photo === undefined;
  const cameraButton = (label: string) => (
    <label className={`btn-muted inline-flex cursor-pointer items-center justify-center gap-1.5 ${disabled || busy ? "pointer-events-none opacity-60" : ""}`}
      onClick={() => { locationRequest.current = getCurrentLocation(); }}>
      <Camera size={16} aria-hidden="true" />
      <span>{busy ? "Getting location..." : label}</span>
      <input key={inputKey} type="file" accept="image/*" capture="environment" className="sr-only" disabled={disabled || busy}
        aria-label={label} onChange={event => void handleFile(event.target.files?.[0])} />
    </label>
  );

  return (
    <div className="grid gap-2 text-sm">
      <span className="font-medium text-black/80">Photo (optional, geotagged)</span>
      {photo ? (
        <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-2">
          <img src={photo.previewUrl} alt="Remark photo preview" className="max-h-56 w-full rounded-lg object-contain" />
          {photo.latitude != null && photo.longitude != null
            ? <p className="flex items-center gap-1 text-xs text-slate-600"><MapPin size={12} aria-hidden="true" />{formatCoordinates({ latitude: photo.latitude, longitude: photo.longitude, accuracy: photo.accuracy })}</p>
            : <p className="rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800" role="alert">No location: {photo.locationError || "unavailable"} The photo will be saved without a geotag.</p>}
          <div className="flex flex-wrap gap-2">
            {cameraButton("Retake")}
            <button type="button" className="btn-muted" disabled={disabled || busy} onClick={() => onChange(hasExisting ? null : undefined)}>Remove photo</button>
          </div>
        </div>
      ) : showExisting ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-600">The current photo will be kept.</span>
          {cameraButton("Retake")}
          <button type="button" className="btn-muted" disabled={disabled} onClick={() => onChange(null)}>Remove photo</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {cameraButton("Take Photo")}
          {photo === null && hasExisting && <span className="text-xs text-amber-700">The current photo will be removed.</span>}
        </div>
      )}
      {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
    </div>
  );
}

/** Shows a saved remark photo with where and when it was taken. */
export function RemarkPhotoView({ path, photo }: { path: string; photo: RemarkPhotoInfo }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    apiBlobUrl(path)
      .then(result => { objectUrl = result; if (active) setUrl(result); else URL.revokeObjectURL(result); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "Unable to load photo"); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path]);

  const taken = new Date(photo.capturedAt.replace(" ", "T"));
  return (
    <figure className="grid gap-2">
      {url
        ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Field photo" className="max-h-80 w-full rounded-xl border border-slate-200 object-contain" /></a>
        : <div className="grid h-40 place-items-center rounded-xl border border-dashed border-slate-300 text-xs text-slate-500">{error || "Loading photo..."}</div>}
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
        <span>Taken {Number.isNaN(taken.getTime()) ? photo.capturedAt : taken.toLocaleString()}</span>
        {photo.latitude != null && photo.longitude != null ? <>
          <span className="inline-flex items-center gap-1"><MapPin size={12} aria-hidden="true" />{formatCoordinates({ latitude: photo.latitude, longitude: photo.longitude, accuracy: photo.accuracy })}</span>
          <a className="font-semibold text-brand-700 underline" href={mapLink(photo.latitude, photo.longitude)} target="_blank" rel="noreferrer">View on map</a>
        </> : <span className="text-amber-700">No location recorded</span>}
      </figcaption>
    </figure>
  );
}
