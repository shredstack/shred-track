"use client";

import { useEffect, useState } from "react";

/**
 * Returns the height (px) the on-screen keyboard is currently covering.
 *
 * Backed by `visualViewport` so it works on iOS Safari where the layout
 * viewport doesn't resize when the keyboard opens. On Chromium/Android the
 * viewport meta `interactive-widget=resizes-content` already reflows the
 * layout, so this hook usually returns ~0 there — that's fine.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;

    const update = () => {
      // Difference between the layout viewport (window.innerHeight) and the
      // visible viewport. When the keyboard is closed these are equal.
      const next = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setInset(next);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
