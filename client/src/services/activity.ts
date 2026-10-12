import { useEffect } from "react";
import { apiRequest } from "./api";

const HEARTBEAT_MS = 60_000;

function send(path: string) {
  // Usage tracking is best-effort and must never surface errors to users.
  void apiRequest(path, "POST").catch(() => undefined);
}

export function useActivityTracking(pathname: string, enabled: boolean) {
  useEffect(() => {
    if (enabled) send("/activity/visit");
  }, [pathname, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") send("/activity/heartbeat");
    }, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [enabled]);
}
