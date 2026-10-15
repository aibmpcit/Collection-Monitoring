import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentProofField, proofPayload, RemarkEvidenceField, remarkEvidencePayload, type PaymentProofUpload } from "./FieldEvidence";

vi.mock("../services/photo", async () => ({
  ...await vi.importActual<typeof import("../services/photo")>("../services/photo"),
  prepareGeotaggedPhoto: vi.fn(async () => ({
    name: "remark-photo.jpg", type: "image/jpeg", data: "cGhvdG8=", latitude: 11.5, longitude: 122.5, accuracy: 8,
    capturedAt: "2026-10-15T09:00:00", previewUrl: "data:image/jpeg;base64,cGhvdG8=", locationError: ""
  }))
}));

let fixes: Array<"ok" | "denied">;
function stubGeolocation(sequence: Array<"ok" | "denied">) {
  fixes = [...sequence];
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (success: PositionCallback, failure: PositionErrorCallback) => (fixes.shift() ?? "ok") === "ok"
        ? success({ coords: { latitude: 11.5, longitude: 122.5, accuracy: 8 } } as GeolocationPosition)
        : failure({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 } as GeolocationPositionError)
    }
  });
}
afterEach(() => { Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true }); });

const file = (name: string, type: string) => {
  const blob = new File(["proof"], name, { type });
  return blob;
};

describe("PaymentProofField", () => {
  it("needs a photo or file and the current location, as two steps", async () => {
    stubGeolocation(["ok"]);
    const onChange = vi.fn();
    render(<PaymentProofField proof={null} onChange={onChange} />);
    expect(screen.getByLabelText("Take Photo")).toHaveAttribute("capture", "environment");
    await userEvent.upload(screen.getByLabelText("Attach File"), file("receipt.pdf", "application/pdf"));
    expect(screen.getByText("receipt.pdf")).toBeInTheDocument();
    // A file alone is not enough.
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Add current location" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const proof = onChange.mock.calls.at(-1)![0] as PaymentProofUpload;
    expect(proof).toMatchObject({ kind: "attachment", name: "receipt.pdf", type: "application/pdf", latitude: 11.5, longitude: 122.5, accuracy: 8 });
    expect(screen.getByText("11.500000, 122.500000 (±8 m)")).toBeInTheDocument();
  });

  it("stamps a photo once the location is added, in either order", async () => {
    stubGeolocation(["ok"]);
    const onChange = vi.fn();
    render(<PaymentProofField proof={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Add current location" }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.upload(screen.getByLabelText("Take Photo"), file("camera.jpg", "image/jpeg"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: "photo", latitude: 11.5 })));
  });

  it("explains when the location is unavailable and lets the collector try again", async () => {
    stubGeolocation(["denied", "ok"]);
    const onChange = vi.fn();
    render(<PaymentProofField proof={null} onChange={onChange} />);
    await userEvent.upload(screen.getByLabelText("Attach File"), file("receipt.pdf", "application/pdf"));
    await userEvent.click(screen.getByRole("button", { name: "Add current location" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't get the current location.");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Add current location" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: "attachment", latitude: 11.5 })));
  });

  it("never uploads the preview copy", () => {
    const proof: PaymentProofUpload = { kind: "photo", name: "p.jpg", type: "image/jpeg", data: "x", latitude: 1, longitude: 2, accuracy: 3, capturedAt: "2026-10-15T09:00:00", previewUrl: "data:..." };
    expect(proofPayload(proof)).not.toHaveProperty("previewUrl");
    expect(proofPayload(null)).toBeUndefined();
  });
});

describe("remarkEvidencePayload", () => {
  const photoFile = { kind: "photo" as const, name: "x.jpg", type: "image/jpeg", data: "eA==", capturedAt: "2026-10-15T09:00:00", previewUrl: "data:" };
  const at = { latitude: 11.5, longitude: 122.5, accuracy: 8 };
  it("sends a photo with its coordinates, plus the location", () => {
    expect(remarkEvidencePayload({ file: photoFile, location: at }, false)).toEqual({
      photo: { name: "x.jpg", type: "image/jpeg", data: "eA==", capturedAt: "2026-10-15T09:00:00", latitude: 11.5, longitude: 122.5, accuracy: 8 },
      location: at
    });
  });
  it("allows just a file, or just a location", () => {
    expect(remarkEvidencePayload({ file: { ...photoFile, kind: "attachment", name: "a.pdf", type: "application/pdf" }, location: null }, true)).toEqual({
      attachment: { name: "a.pdf", type: "application/pdf", data: "eA==" },
      photo: null
    });
    expect(remarkEvidencePayload({ file: null, location: at }, false)).toEqual({ location: at });
    expect(remarkEvidencePayload(null, true)).toEqual({});
  });
});

describe("RemarkEvidenceField", () => {
  it("is optional and accepts a location on its own", async () => {
    stubGeolocation(["ok"]);
    const onChange = vi.fn();
    render(<RemarkEvidenceField proof={null} onChange={onChange} />);
    expect(screen.getByText(/\(optional\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add current location" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ file: null, location: { latitude: 11.5, longitude: 122.5, accuracy: 8 } }));
  });

  it("accepts a file on its own", async () => {
    const onChange = vi.fn();
    render(<RemarkEvidenceField proof={null} onChange={onChange} />);
    await userEvent.upload(screen.getByLabelText("Attach File"), file("letter.pdf", "application/pdf"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ file: expect.objectContaining({ kind: "attachment", name: "letter.pdf" }), location: null })));
  });
});
