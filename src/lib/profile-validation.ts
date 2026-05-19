// Profile form validation + formatting helpers (issue #1).
//
// Used by the profile edit forms to give immediate, structured feedback
// (masked phone input, postal-code patterns, US state dropdown) instead
// of leaving everything as free text.

import { z } from "zod";

// ---------------------------------------------------------------------------
// US states
// ---------------------------------------------------------------------------

export const US_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

const US_STATE_CODES = new Set(US_STATES.map((s) => s.code));

// ---------------------------------------------------------------------------
// Countries (top-of-list defaults — the rest is just a typeable input)
// ---------------------------------------------------------------------------

export const COUNTRY_OPTIONS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "MX", name: "Mexico" },
  { code: "GB", name: "United Kingdom" },
  { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },
  { code: "IE", name: "Ireland" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "FI", name: "Finland" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "SG", name: "Singapore" },
  { code: "BR", name: "Brazil" },
];

// ---------------------------------------------------------------------------
// Phone formatting + validation
// ---------------------------------------------------------------------------

/**
 * Masks a phone number as the user types. Best-effort: handles US-style
 * 10-digit numbers with optional +1 country code and falls back to
 * groups-of-three for international.
 */
export function formatPhoneInput(raw: string): string {
  // Preserve a leading +. Strip everything else to digits.
  const hasPlus = raw.trim().startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return hasPlus ? "+" : "";

  // US/Canada: 10 digits, optionally prefixed with country code 1.
  if (!hasPlus && digits.length <= 10) {
    if (digits.length <= 3) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  }
  if (!hasPlus && digits.length === 11 && digits.startsWith("1")) {
    const rest = digits.slice(1);
    return `+1 (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6, 10)}`;
  }

  // International / E.164-style: keep the + and group conservatively.
  // +CC AAA BBB CCCC — chunks of 3 then 4 isn't reliable across countries,
  // so we keep it loose: +CC <rest>.
  if (digits.length <= 3) return `+${digits}`;
  return `+${digits.slice(0, digits.length - 10)} ${digits.slice(-10, -7)} ${digits.slice(-7, -4)} ${digits.slice(-4)}`.trim();
}

/** Strips formatting to E.164-ish (just digits, optional leading +). */
export function normalizePhone(raw: string): string {
  const hasPlus = raw.trim().startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return hasPlus ? `+${digits}` : digits;
}

const phoneSchema = z
  .string()
  .min(0)
  .transform((v) => v.trim())
  .refine(
    (v) => v === "" || /^\+?\d{7,15}$/.test(normalizePhone(v).replace(/^\+/, "+")),
    "Enter a valid phone number (7–15 digits)."
  );

// ---------------------------------------------------------------------------
// Postal code validation
// ---------------------------------------------------------------------------

const POSTAL_PATTERNS: Record<string, RegExp> = {
  US: /^\d{5}(-\d{4})?$/,
  CA: /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/,
  GB: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i,
  AU: /^\d{4}$/,
  NZ: /^\d{4}$/,
  DE: /^\d{5}$/,
  FR: /^\d{5}$/,
};

export function validatePostalCode(
  postal: string,
  country: string | null
): string | null {
  if (!postal) return null;
  const pattern = country ? POSTAL_PATTERNS[country] : null;
  if (!pattern) {
    // No country-specific pattern: just enforce a sensible length.
    if (postal.length < 3 || postal.length > 12) {
      return "Postal code looks too short or too long.";
    }
    return null;
  }
  if (!pattern.test(postal)) {
    if (country === "US") return "Use 12345 or 12345-6789.";
    if (country === "CA") return "Use Canadian format, e.g. K1A 0B1.";
    return "Doesn't match this country's postal-code format.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Top-level zod schemas
// ---------------------------------------------------------------------------

export const personalInfoSchema = z
  .object({
    dateOfBirth: z
      .string()
      .refine(
        (v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v),
        "Use YYYY-MM-DD."
      )
      .refine((v) => {
        if (!v) return true;
        const d = new Date(`${v}T00:00:00Z`);
        if (Number.isNaN(d.getTime())) return false;
        const year = Number(v.slice(0, 4));
        return year >= 1900 && d <= new Date();
      }, "Date of birth must be in the past."),
    phone: phoneSchema,
    addressLine1: z.string().max(120),
    addressLine2: z.string().max(120),
    city: z.string().max(80),
    state: z.string().max(64),
    postalCode: z.string().max(16),
    country: z.string().max(2),
  })
  .superRefine((value, ctx) => {
    if (value.country === "US" && value.state && !US_STATE_CODES.has(value.state)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["state"],
        message: "Pick a US state.",
      });
    }
    const postalErr = validatePostalCode(
      value.postalCode ?? "",
      value.country || null
    );
    if (postalErr) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["postalCode"],
        message: postalErr,
      });
    }
  });

export type PersonalInfoFields = z.infer<typeof personalInfoSchema>;

export const emergencyContactSchema = z.object({
  name: z.string().max(120),
  phone: phoneSchema,
  relation: z.string().max(60),
});

export type EmergencyContactFields = z.infer<typeof emergencyContactSchema>;

// ---------------------------------------------------------------------------
// Helpers to derive a per-field error map from a zod parse result.
// ---------------------------------------------------------------------------

export function fieldErrors(
  result: { success: true } | { success: false; error: z.ZodError }
): Record<string, string> {
  if (result.success) return {};
  const errs: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".");
    if (!errs[key]) errs[key] = issue.message;
  }
  return errs;
}
