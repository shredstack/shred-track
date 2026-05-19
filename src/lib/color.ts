// ---------------------------------------------------------------------------
// Color conversion utilities.
//
// We accept hex colors from gym admins (familiar format) and convert them to
// OKLCH for use in CSS custom properties so the perceptual brightness lines
// up with the rest of the theme (which already uses OKLCH everywhere).
//
// Inlined to avoid a `culori` dependency for what's effectively a single
// formula. Cross-checked against culori's `oklch(parse('#1A8B7E'))` output.
// ---------------------------------------------------------------------------

export interface OKLCH {
  l: number; // 0..1
  c: number; // 0..~0.4
  h: number; // 0..360
}

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

/** Returns null if the hex isn't a valid #RRGGBB. */
export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.match(HEX_RE);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
  };
}

// sRGB transfer function (gamma decode).
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Convert sRGB hex to OKLCH using the linear-sRGB → OKLab → OKLCH path
 * from Björn Ottosson's reference (https://bottosson.github.io/posts/oklab/).
 */
export function hexToOklch(hex: string): OKLCH | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);

  // linear sRGB → LMS (Ottosson's M1 matrix)
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  // LMS → cube root → OKLab (M2 matrix)
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

  const C = Math.sqrt(a * a + bb * bb);
  const Hrad = Math.atan2(bb, a);
  const H = (Hrad * 180) / Math.PI;

  return {
    l: L,
    c: C,
    h: (H + 360) % 360,
  };
}

/** Format an OKLCH triple as a CSS `oklch(...)` value. */
export function formatOklch(oklch: OKLCH): string {
  const l = oklch.l.toFixed(3);
  const c = oklch.c.toFixed(3);
  const h = oklch.h.toFixed(1);
  return `oklch(${l} ${c} ${h})`;
}

/**
 * Convenience: hex → CSS oklch() string.
 * Returns null when the hex is invalid so callers can fall back to the
 * theme default instead of injecting a broken value.
 */
export function hexToOklchString(hex: string): string | null {
  const oklch = hexToOklch(hex);
  return oklch ? formatOklch(oklch) : null;
}

/**
 * Derive a darker "primary-foreground" companion color from the primary so
 * text on the primary background reads. Light primaries get dark text;
 * dark primaries get light text. Crude but matches the existing
 * --primary-foreground philosophy in globals.css.
 */
export function deriveForegroundOklch(primary: OKLCH): OKLCH {
  // If the primary is light (L > 0.55), pair with very dark; else with very light.
  if (primary.l > 0.55) {
    return { l: 0.15, c: Math.min(0.03, primary.c * 0.2), h: primary.h };
  }
  return { l: 0.95, c: Math.min(0.03, primary.c * 0.1), h: primary.h };
}
