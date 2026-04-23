// ---------------------------------------------------------------------------
// Public entry point for the generic plan template renderer.
//
// Consumers (seed script, tests, the /api/hyrox/plan/free endpoint when it
// lands in phase 2) should only import from here.
// ---------------------------------------------------------------------------

export {
  renderTemplate,
  allTemplateVariants,
  templateKey,
  templateTitle,
  trainingPhilosophy,
  type RenderedTemplate,
} from "./renderer";

export {
  stationTargetsFor,
  tempoPaceForPhase,
  easyPaceForPhase,
  racePaceForPhase,
  PACE_TIERS,
  GENDERS,
  RACE_FORMATS,
  type Gender,
  type RaceFormat,
  type PaceTier,
  type WeightTier,
  type StationTargets,
} from "./calibration";

export { PHASES, phaseForWeek, type GenericPhase } from "./phases";
