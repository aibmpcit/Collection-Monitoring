import { Router } from "express";
import { authenticate, type AuthedRequest } from "../middleware/auth.js";
import { getRequestUser } from "../services/access.js";
import { recordActivity } from "../services/activity.js";

const router = Router();

router.post("/visit", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    await recordActivity(getRequestUser(req).id, "visit");
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

router.post("/heartbeat", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    await recordActivity(getRequestUser(req).id, "heartbeat");
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

export { router as activityRouter };
