import { MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { apiBlobUrl } from "../services/api";
import { describeLocation, mapLink } from "../services/photo";

export interface RemarkPhotoInfo {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  placeName?: string | null;
  capturedAt: string;
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
          <span className="inline-flex items-center gap-1"><MapPin size={12} aria-hidden="true" />{describeLocation({ latitude: photo.latitude, longitude: photo.longitude, accuracy: photo.accuracy, placeName: photo.placeName })}</span>
          <a className="font-semibold text-brand-700 underline" href={mapLink(photo.latitude, photo.longitude)} target="_blank" rel="noreferrer">View on map</a>
        </> : <span className="text-amber-700">No location recorded</span>}
      </figcaption>
    </figure>
  );
}
