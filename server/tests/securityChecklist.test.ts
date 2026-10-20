import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The real app (headers, default-deny, static files) with the database mocked.
const mocks = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }));
vi.mock("../src/config/db.js", () => ({ query: mocks.query, withTransaction: vi.fn() }));
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret";

import { app } from "../src/app.js";
import { canShowInline, detectFileType, servedContentType, storedAttachmentType } from "../src/services/fileTypes.js";
import { assertBranchAccess } from "../src/services/access.js";

let server: Server;
let base: string;
beforeAll(async () => {
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

describe("security headers", () => {
  it("sends CSP with frame-ancestors none, nosniff, and no X-Powered-By", async () => {
    const response = await fetch(`${base}/api/health`);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-powered-by")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("default deny", () => {
  it("only health and sign-in are public; every other API route needs a signed-in user", async () => {
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    // Sign-in is reachable (it answers about the payload, not about the token).
    expect((await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(400);
    for (const path of ["/api/loans?page=1", "/api/staff", "/api/branches", "/api/payments?page=1", "/api/auth/me", "/api/a-route-added-later"]) {
      expect((await fetch(`${base}${path}`)).status, path).toBe(401);
    }
  });
});

describe("records in other branches", () => {
  it("answer 404 like missing ones, so ids can't be probed", () => {
    expect(() => assertBranchAccess({ id: 1, username: "a", role: "branch_admin", branchId: 2 } as never, 3))
      .toThrow(expect.objectContaining({ status: 404, message: "Not found" }));
    expect(() => assertBranchAccess({ id: 1, username: "a", role: "super_admin", branchId: null } as never, 3)).not.toThrow();
  });
});

describe("upload types come from the file's bytes", () => {
  const bytes = (...values: number[]) => Buffer.from(values);
  it("recognises images and PDFs by signature", () => {
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(detectFileType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(detectFileType(Buffer.from("\0\0\0\x18ftypheic"))).toBe("image/heic");
    expect(detectFileType(Buffer.from("%PDF-1.7"))).toBe("application/pdf");
    expect(detectFileType(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
  });
  it("stores and serves anything unrecognised as a plain download, never as a page", () => {
    expect(storedAttachmentType(Buffer.from("<svg onload=alert(1)>"))).toBe("application/octet-stream");
    expect(servedContentType("text/html")).toBe("application/octet-stream");
    expect(servedContentType("image/svg+xml")).toBe("application/octet-stream");
    expect(servedContentType("application/pdf")).toBe("application/pdf");
    expect(canShowInline("image/jpeg")).toBe(true);
    expect(canShowInline("application/pdf")).toBe(false);
    expect(canShowInline("text/html")).toBe(false);
  });
});
