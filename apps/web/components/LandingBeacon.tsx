"use client";
import { useEffect } from "react";
import { trackLanding } from "@/lib/actions/account";

/** F26.6: records a first-party "landing" event when the URL carries utm_* or ref. */
export function LandingBeacon() {
  useEffect(() => {
    const p = Object.fromEntries(new URLSearchParams(window.location.search));
    if (Object.keys(p).some((k) => k.startsWith("utm_") || k === "ref")) void trackLanding(p);
  }, []);
  return null;
}
