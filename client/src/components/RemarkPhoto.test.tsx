import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCoordinates, getCurrentLocation, mapLink, photoPayload, wallClock, type CapturedPhoto } from "../services/photo";

const captured: CapturedPhoto = {
  name: "remark-photo.jpg", type: "image/jpeg", data: "abc", latitude: 11.584123, longitude: 122.543211, accuracy: 12,
  capturedAt: "2026-10-15T07:30:15", previewUrl: "data:image/jpeg;base64,abc", locationError: ""
};

vi.mock("../services/photo", async () => ({
  ...await vi.importActual<typeof import("../services/photo")>("../services/photo"),
  prepareGeotaggedPhoto: vi.fn(async () => captured)
}));
import { RemarkPhotoField } from "./RemarkPhoto";

function stubGeolocation(result: "ok" | "denied") {
  const geolocation = {
    getCurrentPosition: (success: PositionCallback, failure: PositionErrorCallback) => result === "ok"
      ? success({ coords: { latitude: 11.5, longitude: 122.5, accuracy: 8 } } as GeolocationPosition)
      : failure({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 } as GeolocationPositionError)
  };
  Object.defineProperty(navigator, "geolocation", { value: geolocation, configurable: true });
}

afterEach(() => { Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true }); });

describe("photo helpers", () => {
  it("formats time, coordinates and map links", () => {
    expect(wallClock(new Date(2026, 9, 5, 7, 3, 9))).toBe("2026-10-05T07:03:09");
    expect(formatCoordinates({ latitude: 11.5841234, longitude: 122.5432109, accuracy: 12.4 })).toBe("11.584123, 122.543211 (±12 m)");
    expect(mapLink(11.5, 122.5)).toBe("https://www.google.com/maps?q=11.5,122.5");
  });

  it("never uploads the preview copy", () => {
    expect(photoPayload(captured)).not.toHaveProperty("previewUrl");
    expect(photoPayload(captured)).not.toHaveProperty("locationError");
    expect(photoPayload(null)).toBeNull();
    expect(photoPayload(undefined)).toBeUndefined();
  });

  it("reads the device location or explains why it can't", async () => {
    stubGeolocation("ok");
    expect(await getCurrentLocation()).toEqual({ fix: { latitude: 11.5, longitude: 122.5, accuracy: 8 }, error: "" });
    stubGeolocation("denied");
    expect((await getCurrentLocation()).error).toMatch(/permission was denied/);
  });
});

describe("RemarkPhotoField", () => {
  it("opens the back camera and shows the stamped photo with its location", async () => {
    stubGeolocation("ok");
    const onChange = vi.fn();
    const { rerender } = render(<RemarkPhotoField photo={undefined} hasExisting={false} onChange={onChange} />);
    const input = screen.getByLabelText("Take Photo") as HTMLInputElement;
    expect(input).toHaveAttribute("capture", "environment");
    expect(input).toHaveAttribute("accept", "image/*");
    await userEvent.upload(input, new File(["x"], "camera.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(captured));

    rerender(<RemarkPhotoField photo={captured} hasExisting={false} onChange={onChange} />);
    expect(screen.getByAltText("Remark photo preview")).toHaveAttribute("src", captured.previewUrl);
    expect(screen.getByText("11.584123, 122.543211 (±12 m)")).toBeInTheDocument();
  });

  it("warns when the photo has no location", () => {
    render(<RemarkPhotoField photo={{ ...captured, latitude: null, longitude: null, accuracy: null, locationError: "Location permission was denied." }} hasExisting={false} onChange={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("No location: Location permission was denied.");
  });

  it("keeps or removes an existing photo when editing", async () => {
    const onChange = vi.fn();
    render(<RemarkPhotoField photo={undefined} hasExisting onChange={onChange} />);
    expect(screen.getByText("The current photo will be kept.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
