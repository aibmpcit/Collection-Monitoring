import type { IncomingMessage, ServerResponse } from "node:http";

export default async function handler(req: IncomingMessage & { url?: string }, res: ServerResponse) {
  try {
    const { app } = await import("../server/src/app.js");

    if (req.url && !req.url.startsWith("/api")) {
      req.url = `/api${req.url.startsWith("/") ? "" : "/"}${req.url}`;
    }

    return app(req, res);
  } catch (error) {
    console.error("API bootstrap failed", error);

    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          message: error instanceof Error ? error.message : "API bootstrap failed"
        })
      );
    }
  }
}
