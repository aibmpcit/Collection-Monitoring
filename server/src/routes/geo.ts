import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { geocoderEnabled, reverseGeocode } from "../services/geocode.js";

const router = Router();

const coordinates = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180)
});

/** Barangay, town and province for a location; the app falls back to coordinates when unknown. */
router.get("/reverse", authenticate, async (req, res) => {
  const parsed = coordinates.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Invalid coordinates" });
  if (!geocoderEnabled()) return res.status(503).json({ message: "Place lookup is turned off" });
  try {
    const place = await reverseGeocode(parsed.data.lat, parsed.data.lng);
    if (!place) return res.status(404).json({ message: "No barangay found for this location" });
    return res.json(place);
  } catch {
    return res.status(503).json({ message: "Place lookup is unavailable right now" });
  }
});

export { router as geoRouter };
