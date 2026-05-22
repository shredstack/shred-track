import type { RxField, RxDefaults } from "@/types/crossfit";

// Per-Rx-field input metadata. Drives the "default value" inputs section
// rendered by both the admin movement form and AdvancedMovementForm.
// Each entry produces 1-2 numeric/text inputs depending on whether the
// field has a gendered split.
export const RX_FIELD_META: Record<
  RxField,
  {
    label: string;
    keys: { key: keyof RxDefaults; label: string; placeholder?: string }[];
  }
> = {
  weight: {
    label: "Weight (lb)",
    keys: [
      { key: "weight_male", label: "M (lb)", placeholder: "e.g. 95" },
      { key: "weight_female", label: "F (lb)", placeholder: "e.g. 65" },
    ],
  },
  weight_bw: {
    label: "% bodyweight",
    keys: [
      { key: "weight_bw_male", label: "M (×BW)", placeholder: "e.g. 1.5" },
      { key: "weight_bw_female", label: "F (×BW)", placeholder: "e.g. 1.25" },
    ],
  },
  weight_pct: {
    label: "% of earlier part max",
    keys: [
      { key: "weight_pct", label: "Default %", placeholder: "e.g. 60" },
    ],
  },
  height: {
    label: "Height (in)",
    keys: [
      { key: "height_inches_male", label: "M (in)", placeholder: "e.g. 24" },
      { key: "height_inches_female", label: "F (in)", placeholder: "e.g. 20" },
    ],
  },
  calories: {
    label: "Calories",
    keys: [
      { key: "calories_male", label: "M (cal)", placeholder: "e.g. 21" },
      { key: "calories_female", label: "F (cal)", placeholder: "e.g. 15" },
    ],
  },
  distance: {
    label: "Distance (m)",
    keys: [
      { key: "distance_male", label: "M (m)", placeholder: "e.g. 400" },
      { key: "distance_female", label: "F (m)", placeholder: "e.g. 320" },
    ],
  },
  duration: {
    label: "Duration (sec)",
    keys: [
      { key: "duration_seconds_male", label: "M (sec)", placeholder: "e.g. 60" },
      {
        key: "duration_seconds_female",
        label: "F (sec)",
        placeholder: "e.g. 60",
      },
    ],
  },
  tempo: {
    label: "Tempo",
    keys: [{ key: "tempo", label: "Tempo", placeholder: "e.g. 30X1" }],
  },
};
