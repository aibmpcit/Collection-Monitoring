import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyticsRouter } from "./routes/analytics.js";
import { authRouter } from "./routes/auth.js";
import { branchRouter } from "./routes/branches.js";
import { borrowerRouter } from "./routes/borrowers.js";
import { collectionRouter } from "./routes/collections.js";
import { collectionHistoryRouter } from "./routes/collectionHistory.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { loanRouter } from "./routes/loans.js";
import { paymentRouter } from "./routes/payments.js";
import { reportsRouter } from "./routes/reports.js";
import { activityRouter } from "./routes/activity.js";
import { geoRouter } from "./routes/geo.js";
import { staffRouter } from "./routes/staff.js";
import { errorResponse } from "./services/access.js";
import { authenticate } from "./middleware/auth.js";
import { auditChanges } from "./services/audit.js";
import "./config/env.js";

const app = express();
// Don't advertise the framework.
app.disable("x-powered-by");

// Browser security headers on every response.
// - CSP: only this site's scripts run; styles/fonts also from Google Fonts; images may be data:/blob:
//   (photo previews); no plugins; the app can't be framed (clickjacking).
// - nosniff: the browser never guesses that a download is a script.
// - HSTS (production, served over HTTPS by the proxy): browsers keep using HTTPS.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");
app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

// Behind a reverse proxy (Dokploy/Traefik), TRUST_PROXY=1 makes req.ip the real client address
// so login limits apply per visitor rather than to the proxy.
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY);
  app.set("trust proxy", Number.isInteger(hops) ? hops : process.env.TRUST_PROXY);
}

// Production serves the UI from the same origin, so cross-origin access is off unless CORS_ORIGIN lists sites.
const corsOrigins = (process.env.CORS_ORIGIN ?? "").split(",").map(origin => origin.trim()).filter(Boolean);
if (corsOrigins.length) {
  app.use(cors({ origin: corsOrigins }));
} else if (process.env.NODE_ENV !== "production") {
  app.use(cors());
}
const bodyLimit = process.env.API_BODY_LIMIT ?? "25mb";

app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

// API answers are per user: never stored by browsers or proxies.
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

// Default deny: every API route needs a signed-in user unless listed here.
const PUBLIC_API_ROUTES = new Set(["GET /health", "POST /auth/login"]);
app.use("/api", (req, res, next) => {
  if (req.method === "OPTIONS" || PUBLIC_API_ROUTES.has(`${req.method} ${req.path}`)) return next();
  return authenticate(req, res, next);
});
// Who changed what, when: every successful change is written to audit_log.
app.use("/api", auditChanges);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRouter);
app.use("/api/branches", branchRouter);
app.use("/api/staff", staffRouter);
app.use("/api/borrowers", borrowerRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/loans", loanRouter);
app.use("/api/payments", paymentRouter);
app.use("/api/collections", collectionRouter);
app.use("/api/collection-history", collectionHistoryRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/activity", activityRouter);
app.use("/api/geo", geoRouter);

// Docker serves the built UI and API from the same origin.
if (process.env.SERVE_CLIENT === "true") {
  const clientDirectory = fileURLToPath(new URL("../../client/dist/", import.meta.url));
  app.use("/api", (_req, res) => res.status(404).json({ message: "API route not found" }));
  // Dotfiles and backups (/.env, /.git/config, site.zip) are never served, not even as the app page.
  app.use((req, res, next) => {
    if (/(^|\/)\.|\.(zip|tar|gz|bak|old|sql|log)$/i.test(req.path)) return res.status(404).end();
    return next();
  });
  app.use(express.static(clientDirectory, { dotfiles: "deny" }));
  app.get("*", (req, res, next) => {
    if (path.extname(req.path)) return next();
    return res.sendFile(path.join(clientDirectory, "index.html"));
  });
}

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if ((error as Error & { type?: string }).type === "entity.too.large") {
    return res.status(413).json({
      message: "Upload file is too large. Try a smaller CSV/Excel file or split it into batches."
    });
  }

  const { status, message } = errorResponse(error);
  // Expected user errors (duplicates, validation, access) are answered, not logged as faults.
  if (status >= 500) console.error(error);
  res.status(status).json({ message });
});

export { app };
