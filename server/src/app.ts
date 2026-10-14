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
import { staffRouter } from "./routes/staff.js";
import { errorResponse } from "./services/access.js";
import "./config/env.js";

const app = express();

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

// Docker serves the built UI and API from the same origin.
if (process.env.SERVE_CLIENT === "true") {
  const clientDirectory = fileURLToPath(new URL("../../client/dist/", import.meta.url));
  app.use("/api", (_req, res) => res.status(404).json({ message: "API route not found" }));
  app.use(express.static(clientDirectory));
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

  console.error(error);
  const { status, message } = errorResponse(error);
  res.status(status).json({ message });
});

export { app };
