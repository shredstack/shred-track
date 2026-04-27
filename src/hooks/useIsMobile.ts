"use client";

import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT = 640;

/**
 * Returns `true` when the viewport is at the mobile breakpoint (< 640px,
 * matching Tailwind's `sm`). SSR-safe: returns `false` on the server and on
 * the first client render, then updates after mount to avoid hydration
 * mismatches.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return isMobile;
}
