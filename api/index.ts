import { app } from "../server/src/app.js";

import type { IncomingMessage, ServerResponse } from "node:http";

export default function handler(req: IncomingMessage & { url?: string }, res: ServerResponse) {
  if (req.url && !req.url.startsWith("/api")) {
    req.url = `/api${req.url.startsWith("/") ? "" : "/"}${req.url}`;
  }

  return app(req, res);
}
