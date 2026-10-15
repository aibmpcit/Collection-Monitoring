import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCoordinates, getCurrentLocation, mapLink, photoPayload, wallClock, type CapturedPhoto } from "../services/photo";

const captured: CapturedPhoto = {
  name: "remark-photo.jpg", type: "image/jpeg", data: "abc", latitude: 11.584123, longitude: 122.543211, accuracy: 12,
  capturedAt: "2026-10-15T07:30:15", previewUrl: "data:image/jpeg;base64,abc", locationError: ""
};


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
