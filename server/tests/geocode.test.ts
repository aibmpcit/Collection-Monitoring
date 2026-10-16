import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JwtUser } from "../src/types/models.js";

vi.mock("../src/middleware/auth.js", async () => ({
  ...await vi.importActual<typeof import("../src/middleware/auth.js")>("../src/middleware/auth.js"),
  authenticate: (req: { user: JwtUser }, _res: unknown, next: () => void) => { req.user = { id: 7, role: "staff", branchId: 2 } as JwtUser; next(); }
}));
import { clearGeocodeCache, placeFromAddress } from "../src/services/geocode.js";
import { geoRouter } from "../src/routes/geo.js";

describe("placeFromAddress", () => {
  it("names the barangay, town and province from an OpenStreetMap address", () => {
    expect(placeFromAddress({ road: "T. A. Fornier Street", quarter: "Centro Poblacion", village: "Centro Norte", town: "Culasi", state: "Antique" }))
      .toEqual({ barangay: "Centro Norte", town: "Culasi", province: "Antique", label: "Brgy. Centro Norte, Culasi, Antique" });
  });

  it("uses city barangays and avoids doubling the prefix", () => {
    expect(placeFromAddress({ suburb: "Barangay 5", city: "Roxas City", state: "Capiz" })?.label).toBe("Brgy. 5, Roxas City, Capiz");
  });

  it("returns nothing when neither barangay nor town is known", () => {
    expect(placeFromAddress({ country: "Philippines" })).toBeNull();
    expect(placeFromAddress(undefined)).toBeNull();
  });
});

describe("GET /geo/reverse", () => {
  let server: Server;
  let base: string;
  const realFetch = globalThis.fetch;
  const upstream = vi.fn();

  beforeAll(async () => {
    const app = express();
    app.use("/geo", geoRouter);
    server = await new Promise<Server>(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
  beforeEach(() => {
    clearGeocodeCache();
    upstream.mockReset();
    delete process.env.GEOCODER;
    // Calls to the test server pass through; calls to OpenStreetMap are answered by the mock.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => String(input).startsWith("https://nominatim")
      ? upstream(String(input), init)
      : realFetch(input, init)) as typeof fetch;
  });
  afterAll(() => { globalThis.fetch = realFetch; });

  it("returns the barangay and identifies itself to OpenStreetMap", async () => {
    upstream.mockResolvedValue(new Response(JSON.stringify({ address: { village: "Centro Norte", town: "Culasi", state: "Antique" } })));
    const response = await realFetch(`${base}/geo/reverse?lat=11.429049&lng=122.057092`);
    expect(await response.json()).toMatchObject({ label: "Brgy. Centro Norte, Culasi, Antique" });
    const [url, init] = upstream.mock.calls[0];
    expect(url).toContain("lat=11.429049&lon=122.057092");
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/^BMPC-Collection-Monitoring/);
  });

  it("caches nearby lookups", async () => {
    upstream.mockResolvedValue(new Response(JSON.stringify({ address: { village: "Centro Norte", town: "Culasi" } })));
    await realFetch(`${base}/geo/reverse?lat=11.42904&lng=122.05709`);
    upstream.mockResolvedValue(new Response(JSON.stringify({ address: { village: "Centro Norte", town: "Culasi" } })));
    await realFetch(`${base}/geo/reverse?lat=11.42901&lng=122.05711`);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable or turned off, so the app can fall back to coordinates", async () => {
    upstream.mockRejectedValue(new Error("offline"));
    expect((await realFetch(`${base}/geo/reverse?lat=10&lng=122`)).status).toBe(503);
    process.env.GEOCODER = "off";
    expect((await realFetch(`${base}/geo/reverse?lat=10.5&lng=122`)).status).toBe(503);
    expect((await realFetch(`${base}/geo/reverse?lat=200&lng=122`)).status).toBe(400);
  });
});
