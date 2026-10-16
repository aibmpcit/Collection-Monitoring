import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JwtUser } from "../src/types/models.js";

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), user: { id: 7, role: "staff", branchId: 2 } as JwtUser, branch: 2 }));
vi.mock("../src/config/db.js", () => ({ query: mocks.query, withTransaction: mocks.transaction }));
vi.mock("../src/middleware/auth.js", async () => ({
  ...await vi.importActual<typeof import("../src/middleware/auth.js")>("../src/middleware/auth.js"),
  authenticate: (req: { user: JwtUser }, _res: unknown, next: () => void) => { req.user = mocks.user; next(); }
}));
import { mapPhotoColumns, parsePhoto } from "../src/services/remarkPhotos.js";
import { loanRouter } from "../src/routes/loans.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]).toString("base64");
const photo = (overrides: Record<string, unknown> = {}) => ({
  name: "visit.jpg", type: "image/jpeg", data: JPEG, latitude: 11.5841234, longitude: 122.5432109, accuracy: 12.4,
  capturedAt: "2026-10-15T07:30:15", ...overrides
});

let server: Server;
let base: string;
const calls = () => mocks.query.mock.calls as [string, unknown[]][];
beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/loans", loanRouter);
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => {
  mocks.user = { id: 7, role: "staff", branchId: 2 } as JwtUser;
  mocks.branch = 2;
  mocks.query.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes("FROM loans l") && sql.includes("WHERE l.id = $1")) return { rows: [{ id: 9, branch_id: mocks.branch }], rowCount: 1 };
    if (sql.includes("created_by, b.branch_id")) return { rows: [{ created_by: 7, branch_id: mocks.branch, remark_category: "others" }], rowCount: 1 };
    if (sql.includes("FROM remark_photos WHERE")) return { rows: [{ file_name: "visit.jpg", mime_type: "image/jpeg", file_data: Buffer.from(JPEG, "base64") }], rowCount: 1 };
    return { rows: [{ id: 31 }], rowCount: 1 };
  });
  mocks.transaction.mockReset().mockImplementation(handler => handler({ query: mocks.query }));
});

describe("parsePhoto", () => {
  it("keeps the geotag, rounded to six decimals, and the capture time as typed on the phone", () => {
    expect(parsePhoto(photo())).toMatchObject({ type: "image/jpeg", latitude: 11.584123, longitude: 122.543211, accuracy: 12, capturedAt: "2026-10-15 07:30:15" });
  });

  it("accepts a photo without a location", () => {
    expect(parsePhoto(photo({ latitude: null, longitude: null, accuracy: null }))).toMatchObject({ latitude: null, longitude: null });
  });

  it("rejects non-images, impossible coordinates and half a location", () => {
    expect(() => parsePhoto(photo({ type: "application/pdf" }))).toThrow("Photo must be a JPEG, PNG or WebP image");
    expect(() => parsePhoto(photo({ latitude: 95 }))).toThrow("Invalid photo location");
    expect(() => parsePhoto(photo({ longitude: null }))).toThrow("Invalid photo location");
    expect(() => parsePhoto(photo({ data: "" }))).toThrow("Invalid photo");
  });

  it("distinguishes leave-as-is from remove", () => {
    expect(parsePhoto(undefined)).toBeUndefined();
    expect(parsePhoto(null)).toBeNull();
  });

  it("maps list columns to a photo summary", () => {
    expect(mapPhotoColumns({ photo_id: null })).toEqual({ photo: null });
    expect(mapPhotoColumns({ photo_id: 3, photo_latitude: "11.584123", photo_longitude: "122.543211", photo_accuracy: 12, photo_captured_at: "2026-10-15 07:30:15" }))
      .toEqual({ photo: { latitude: 11.584123, longitude: 122.543211, accuracy: 12, placeName: null, capturedAt: "2026-10-15 07:30:15" } });
  });
});

describe("remark photos", () => {
  const send = (path: string, body: unknown, method = "POST") => fetch(`${base}${path}`, {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });

  it("saves a geotagged photo alongside a new remark", async () => {
    const response = await send("/loans/9/remarks", { remark: "Visited the house", remarkCategory: "visited", photo: photo(), location: { latitude: 11.5841234, longitude: 122.5432109, accuracy: 12 } });
    expect(response.status).toBe(201);
    const insert = calls().find(([sql]) => sql.includes("INSERT INTO remark_photos"))!;
    expect(insert[1].slice(0, 4)).toEqual(["loan", 31, "visit.jpg", "image/jpeg"]);
    expect(insert[1].slice(5)).toEqual([11.584123, 122.543211, 12, null, "2026-10-15 07:30:15"]);
  });

  it("rejects an invalid photo before saving the remark", async () => {
    const response = await send("/loans/9/remarks", { remark: "x", photo: photo({ type: "text/plain" }) });
    expect(response.status).toBe(400);
    expect(calls().some(([sql]) => sql.includes("INSERT INTO loan_remarks"))).toBe(false);
  });

  it("removes the photo when an edit sends photo: null", async () => {
    await send("/loans/9/remarks/31", { remark: "Updated", remarkCategory: "others", photo: null }, "PATCH");
    const removed = calls().find(([sql]) => sql.startsWith("DELETE FROM remark_photos"))!;
    expect(removed[1]).toEqual(["loan", 31]);
  });

  it("serves the photo inline to people in the branch only", async () => {
    const response = await fetch(`${base}/loans/9/remarks/31/photo`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-disposition")).toContain("inline");
    mocks.branch = 3;
    expect((await fetch(`${base}/loans/9/remarks/31/photo`)).status).toBe(403);
  });
});
