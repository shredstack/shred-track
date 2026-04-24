// ============================================
// Workout Types
// ============================================

export const WORKOUT_TYPES = [
  "for_time",
  "amrap",
  "for_load",
  "for_reps",
  "for_calories",
  "emom",
  "tabata",
  "max_effort",
  "other",
] as const;

export type WorkoutType = (typeof WORKOUT_TYPES)[number];

export const WORKOUT_TYPE_LABELS: Record<WorkoutType, string> = {
  for_time: "For Time",
  amrap: "AMRAP",
  for_load: "For Load",
  for_reps: "For Reps",
  for_calories: "For Calories",
  emom: "EMOM",
  tabata: "Tabata",
  max_effort: "Max Effort",
  other: "Other",
};

export const WORKOUT_TYPE_COLORS: Record<WorkoutType, string> = {
  for_time: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  amrap: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  for_load: "bg-red-500/20 text-red-400 border-red-500/30",
  for_reps: "bg-green-500/20 text-green-400 border-green-500/30",
  for_calories: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  emom: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  tabata: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  max_effort: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  other: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

// ============================================
// Movement Categories
// ============================================

export const MOVEMENT_CATEGORIES = [
  "barbell",
  "dumbbell",
  "kettlebell",
  "gymnastics",
  "bodyweight",
  "monostructural",
  "accessory",
  "other",
] as const;

export type MovementCategory = (typeof MOVEMENT_CATEGORIES)[number];

export const MOVEMENT_CATEGORY_COLORS: Record<MovementCategory, string> = {
  barbell: "bg-red-500/20 text-red-400",
  dumbbell: "bg-orange-500/20 text-orange-400",
  kettlebell: "bg-yellow-500/20 text-yellow-400",
  gymnastics: "bg-blue-500/20 text-blue-400",
  bodyweight: "bg-green-500/20 text-green-400",
  monostructural: "bg-purple-500/20 text-purple-400",
  accessory: "bg-zinc-500/20 text-zinc-400",
  other: "bg-zinc-500/20 text-zinc-400",
};

// ============================================
// Parsed Workout (from text parser)
// ============================================

export interface ParsedMovement {
  name: string;
  matchedCanonicalName?: string;
  reps?: string;
  weightMale?: number;
  weightFemale?: number;
  weightUnit?: "lb" | "kg";
  notes?: string;
  confidence: number; // 0-1
}

export interface ParsedWorkout {
  title?: string;
  workoutType: WorkoutType;
  workoutTypeConfidence: number;
  timeCapSeconds?: number;
  amrapDurationSeconds?: number;
  repScheme?: string;
  movements: ParsedMovement[];
  rawText: string;
  description?: string;
}

// ============================================
// Benchmark Workout Types
// ============================================

export interface BenchmarkWorkout {
  id: string;
  name: string;
  description: string | null;
  workoutType: WorkoutType;
  timeCapSeconds: number | null;
  amrapDurationSeconds: number | null;
  repScheme: string | null;
  isSystem: boolean;
  createdBy: string | null;
  communityId: string | null;
  movements: BenchmarkMovement[];
}

export interface BenchmarkMovement {
  id: string;
  movementId: string;
  movementName: string;
  orderIndex: number;
  prescribedReps: string | null;
  prescribedWeightMale: number | null;
  prescribedWeightFemale: number | null;
  rxStandard: string | null;
}

export type BenchmarkCategory = "system" | "custom" | "community";

// ============================================
// Workout Display Types
// ============================================

export interface WorkoutMovementDisplay {
  id: string;
  movementId: string;
  movementName: string;
  category: MovementCategory;
  orderIndex: number;
  prescribedReps?: string;
  prescribedWeightMale?: string;
  prescribedWeightFemale?: string;
  equipmentCount?: number;
  rxStandard?: string;
  notes?: string;
  isWeighted: boolean;
}

export interface WorkoutPartDisplay {
  id: string;
  orderIndex: number;
  label?: string | null;
  workoutType: WorkoutType;
  timeCapSeconds?: number;
  amrapDurationSeconds?: number;
  emomIntervalSeconds?: number;
  repScheme?: string;
  notes?: string;
  movements: WorkoutMovementDisplay[];
  score?: ScoreDisplay | null;
}

export interface WorkoutDisplay {
  id: string;
  title?: string;
  description?: string;
  workoutDate: string;
  parts: WorkoutPartDisplay[];
  createdBy: string;
  createdByName?: string;
  benchmarkWorkoutId?: string | null;
}

export interface ScoreDisplay {
  id: string;
  workoutPartId?: string;
  division: "rx" | "scaled" | "rx_plus";
  timeSeconds?: number;
  rounds?: number;
  remainderReps?: number;
  weightLbs?: string;
  totalReps?: number;
  scoreText?: string;
  hitTimeCap: boolean;
  notes?: string;
  rpe?: number;
  userName?: string;
  scalingDetails?: MovementScalingDisplay[];
  movementDetails?: ScoreMovementDetailDisplay[];
}

export interface ScoreMovementDetailDisplay {
  workoutMovementId: string;
  movementName?: string;
  wasRx: boolean;
  actualWeight?: number;
  actualReps?: string;
  modification?: string;
  substitutionMovementId?: string;
  setWeights?: number[];
  notes?: string;
}

export interface MovementScalingDisplay {
  workoutMovementId: string;
  movementName: string;
  wasRx: boolean;
  actualWeight?: string;
  actualReps?: string;
  modification?: string;
  substitutionName?: string;
}

// ============================================
// Score Entry Form Types
// ============================================

export interface ScoreInput {
  workoutId: string;
  workoutPartId?: string;
  division: "rx" | "scaled" | "rx_plus";
  timeSeconds?: number;
  rounds?: number;
  remainderReps?: number;
  weightLbs?: number;
  totalReps?: number;
  scoreText?: string;
  hitTimeCap: boolean;
  notes?: string;
  rpe?: number;
  movementScalings: MovementScaling[];
}

export interface MovementScaling {
  workoutMovementId: string;
  wasRx: boolean;
  actualWeight?: number;
  actualReps?: string;
  modification?: string;
  substitutionMovementId?: string;
  setWeights?: number[];
  notes?: string;
}

// ============================================
// Workout Builder Form Types
// ============================================

export interface WorkoutBuilderMovement {
  tempId: string;
  movementId?: string;
  movementName: string;
  category?: MovementCategory;
  isWeighted: boolean;
  prescribedReps: string;
  prescribedWeightMale: string;
  prescribedWeightFemale: string;
  equipmentCount?: number;
  rxStandard: string;
  notes: string;
}

export interface WorkoutBuilderPart {
  tempId: string;
  label: string;
  workoutType: WorkoutType;
  timeCapMinutes: string;
  amrapDurationMinutes: string;
  emomIntervalSeconds: string;
  repScheme: string;
  movements: WorkoutBuilderMovement[];
}

export interface WorkoutBuilderForm {
  title: string;
  description: string;
  workoutDate: string;
  parts: WorkoutBuilderPart[];
  benchmarkWorkoutId?: string | null;
}

// ============================================
// Leaderboard Types
// ============================================

export interface LeaderboardEntry {
  scoreId: string;
  userId: string;
  userName: string;
  division: "rx" | "scaled" | "rx_plus";
  displayScore: string;
  sortValue: number;
  timeSeconds?: number;
  rounds?: number;
  remainderReps?: number;
  weightLbs?: string;
  totalReps?: number;
  scoreText?: string;
  hitTimeCap: boolean;
  rpe?: number;
  scalingDetails?: MovementScalingDisplay[];
}

// ============================================
// Movement Library
// ============================================

export interface MovementOption {
  id: string;
  canonicalName: string;
  category: MovementCategory;
  isWeighted: boolean;
  is1rmApplicable: boolean;
  commonRxWeightMale?: string;
  commonRxWeightFemale?: string;
  videoUrl?: string | null;
}
