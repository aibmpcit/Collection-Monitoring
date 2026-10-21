import { Camera, MapPin, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fileToAttachment } from "../services/attachments";
import { describeLocation, getCurrentLocation, lookupPlace, mapLink, prepareGeotaggedPhoto, wallClock, type GeoFix } from "../services/photo";

export interface GeoPoint {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  /** e.g. "Brgy. Centro Norte, Culasi, Antique"; null when it couldn't be looked up. */
  placeName?: string | null;
}

/** Payment proof: the photo or file is required, the location optional (empty coordinates). */
export interface PaymentProofUpload {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  placeName?: string | null;
  kind: "photo" | "attachment";
  name: string;
  type: string;
  data: string;
  capturedAt: string;
  /** Browser-only preview for photos; stripped before upload. */
  previewUrl?: string;
}

export function proofPayload(proof: PaymentProofUpload | null) {
  if (!proof) return undefined;
  const { previewUrl: _preview, ...payload } = proof;
  return payload;
}

const toPoint = (fix: GeoFix): GeoPoint => ({ latitude: fix.latitude, longitude: fix.longitude, accuracy: Math.round(fix.accuracy) });

export function MapLink({ point, label = "View on map" }: { point: GeoPoint; label?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600">
      <span className="inline-flex items-center gap-1"><MapPin size={12} aria-hidden="true" />{describeLocation(point)}</span>
      <a className="font-semibold text-brand-700 underline" href={mapLink(point.latitude, point.longitude)} target="_blank" rel="noreferrer">{label}</a>
    </span>
  );
}

/** The photo or file part of field evidence. */
export interface EvidenceFile {
  kind: "photo" | "attachment";
  name: string;
  type: string;
  data: string;
  capturedAt: string;
  /** Browser-only preview for photos; never uploaded. */
  previewUrl?: string;
}

/** Remark evidence: both parts are optional. */
export interface RemarkEvidence {
  file: EvidenceFile | null;
  location: GeoPoint | null;
}

/** Payment proof field: a photo or file is required; adding the current location is optional. */
export function PaymentProofField({ proof, onChange, ...rest }: Omit<EvidenceFieldProps, "label" | "required" | "value" | "onEvidence"> & {
  proof: PaymentProofUpload | null;
  onChange: (proof: PaymentProofUpload | null) => void;
}) {
  return <EvidenceField {...rest} label="Proof of payment" required value={proof}
    onEvidence={evidence => onChange(evidence?.file
      ? { ...evidence.file, latitude: evidence.location?.latitude ?? null, longitude: evidence.location?.longitude ?? null,
        accuracy: evidence.location?.accuracy ?? null, placeName: evidence.location?.placeName ?? null }
      : null)} />;
}

/** Remark evidence field: the same two steps, both optional. */
export function RemarkEvidenceField({ proof, onChange, ...rest }: Omit<EvidenceFieldProps, "label" | "required" | "value" | "onEvidence"> & {
  proof: RemarkEvidence | null;
  onChange: (evidence: RemarkEvidence | null) => void;
}) {
  return <EvidenceField {...rest} label="Photo or attachment and location" required={false} value={proof} onEvidence={onChange} />;
}

/**
 * What a remark save sends: a photo goes to `photo`, a file to `attachment`, the coordinates
 * to `location`. When replacing on an edit, the other file kind is cleared so a remark keeps a
 * single photo or file.
 */
export function remarkEvidencePayload(evidence: RemarkEvidence | null, replacing: boolean) {
  if (!evidence) return {};
  const location = evidence.location;
  const payload: Record<string, unknown> = {};
  if (evidence.file?.kind === "photo") {
    const { name, type, data, capturedAt } = evidence.file;
    payload.photo = { name, type, data, capturedAt, latitude: location?.latitude ?? null, longitude: location?.longitude ?? null, accuracy: location?.accuracy ?? null, placeName: location?.placeName ?? null };
    if (replacing) payload.attachment = null;
  } else if (evidence.file) {
    const { name, type, data } = evidence.file;
    payload.attachment = { name, type, data };
    if (replacing) payload.photo = null;
  }
  if (location) payload.location = location;
  return payload;
}

interface EvidenceFieldProps {
  label: string;
  /** Payments: the photo or file is required (location optional). Remarks: everything optional. */
  required: boolean;
  /** The parent's current value; when it is cleared (after saving) the field starts over. */
  value: unknown;
  onEvidence: (evidence: RemarkEvidence | null) => void;
  /** Editing a record that already has evidence: leaving this empty keeps it. */
  hasExisting?: boolean;
  disabled?: boolean;
}

/**
 * Two steps: (1) take a photo or attach a file, (2) add the current location (always optional).
 * Photos are stamped with the time, and the place once a location is added.
 */
export function EvidenceField({ label, required, value, onEvidence, hasExisting = false, disabled = false }: EvidenceFieldProps) {
  const [file, setFile] = useState<{ file: File; kind: PaymentProofUpload["kind"]; previewUrl?: string } | null>(null);
  const [point, setPoint] = useState<GeoPoint | null>(null);
  const [locating, setLocating] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState("");
  const [inputKey, setInputKey] = useState(0);
  const reported = useRef<RemarkEvidence | null>(null);

  // The form cleared its value (e.g. after saving): start over.
  useEffect(() => {
    if (value === null && reported.current) {
      reported.current = null;
      setFile(null);
      setPoint(null);
      setError("");
    }
  }, [value]);

  // Report evidence once enough is there: the photo or file for payments, either step for remarks.
  // Photos are stamped with time (and place, once a location is added).
  useEffect(() => {
    const enough = required ? Boolean(file) : Boolean(file || point);
    if (!enough) {
      if (reported.current) { reported.current = null; onEvidence(null); }
      return;
    }
    let active = true;
    setBuilding(true);
    (async () => {
      try {
        let built: EvidenceFile | null = null;
        if (file?.kind === "photo") {
          const photo = await prepareGeotaggedPhoto(file.file, point
            ? { fix: { ...point, accuracy: point.accuracy ?? 0 }, error: "" }
            : { fix: null, error: "" }, new Date(), point?.placeName ?? "");
          built = { kind: "photo", name: photo.name, type: photo.type, data: photo.data, capturedAt: photo.capturedAt, previewUrl: photo.previewUrl };
        } else if (file) {
          const attachment = await fileToAttachment(file.file);
          if (attachment) built = { kind: "attachment", name: attachment.name, type: attachment.type, data: attachment.data, capturedAt: wallClock(new Date()) };
        }
        const evidence: RemarkEvidence = { file: built, location: point };
        if (active && (built || !file)) { reported.current = evidence; onEvidence(evidence); setError(""); }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Unable to use this file.");
      } finally {
        if (active) setBuilding(false);
      }
    })();
    return () => { active = false; };
  }, [file, point]);

  function chooseFile(chosen: File | undefined, kind: PaymentProofUpload["kind"]) {
    setInputKey(key => key + 1);
    if (!chosen) return;
    if (kind === "photo" && !chosen.type.startsWith("image/")) { setError("Choose a photo."); return; }
    if (chosen.size > 5 * 1024 * 1024 && kind === "attachment") { setError("Attachment must be 5 MB or smaller."); return; }
    setError("");
    setFile({ file: chosen, kind, previewUrl: kind === "photo" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(chosen) : undefined });
  }

  async function addLocation() {
    setLocating(true);
    setError("");
    const location = await getCurrentLocation();
    if (!location.fix) {
      setLocating(false);
      setError(`Couldn't get the current location. ${location.error}`);
      return;
    }
    const point = toPoint(location.fix);
    // Name the barangay when possible; coordinates are kept either way.
    const placeName = await lookupPlace(point.latitude, point.longitude);
    setLocating(false);
    setPoint({ ...point, placeName: placeName || null });
  }

  const busy = locating || building;
  const picker = (kind: PaymentProofUpload["kind"], text: string) => (
    <label className={`btn-muted inline-flex cursor-pointer items-center justify-center gap-1.5 ${disabled || busy ? "pointer-events-none opacity-60" : ""}`}>
      {kind === "photo" ? <Camera size={16} aria-hidden="true" /> : <Paperclip size={16} aria-hidden="true" />}
      <span>{text}</span>
      <input key={`${kind}-${inputKey}`} type="file" className="sr-only" disabled={disabled || busy} aria-label={text}
        {...(kind === "photo" ? { accept: "image/*", capture: "environment" as const } : {})}
        onChange={event => chooseFile(event.target.files?.[0], kind)} />
    </label>
  );
  const preview = (reported.current?.file?.previewUrl) ?? file?.previewUrl;

  return (
    <div className="grid gap-2 text-sm">
      <span className="font-medium text-black/80">{label} {hasExisting ? "(optional: replaces the current one)" : required ? "(required)" : "(optional)"}</span>
      {hasExisting && !file && !point && <span className="text-xs text-slate-500">Anything already saved is kept.</span>}

      <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-2">
        <p className="text-xs font-semibold text-slate-600">{required ? "1. " : ""}Photo or file{required ? " (required)" : ""} {file ? "✓" : ""}</p>
        {file && (preview
          ? <img src={preview} alt={`${label} preview`} className="max-h-56 w-full rounded-lg object-contain" />
          : <p className="flex items-center gap-1 break-all text-sm text-slate-700"><Paperclip size={14} aria-hidden="true" />{file.file.name}</p>)}
        <div className="flex flex-wrap gap-2">
          {picker("photo", file ? "Retake Photo" : "Take Photo")}
          {picker("attachment", file ? "Choose Another File" : "Attach File")}
          {file && <button type="button" className="btn-muted" disabled={disabled || busy} onClick={() => setFile(null)}>Remove</button>}
        </div>

        <p className="mt-1 text-xs font-semibold text-slate-600">{required ? "2. " : ""}Current location{required ? " (optional)" : ""} {point ? "✓" : ""}</p>
        <div className="flex flex-wrap items-center gap-2">
          {point && <MapLink point={point} />}
          {point && <button type="button" className="btn-muted" disabled={disabled || busy} onClick={() => setPoint(null)}>Remove location</button>}
          <button type="button" className="btn-muted inline-flex items-center gap-1.5" disabled={disabled || busy} onClick={() => void addLocation()}>
            <MapPin size={16} aria-hidden="true" />
            <span>{locating ? "Getting location..." : point ? "Update location" : "Add current location"}</span>
          </button>
        </div>
        {building && <p className="text-xs text-slate-500">Preparing...</p>}
      </div>
      {error && <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800" role="alert">{error}</p>}
    </div>
  );
}
