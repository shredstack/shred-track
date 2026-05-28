-- Link a workout_section to the benchmark it represents (e.g. "Fran" picked
-- from the Benchmark tab in the programming admin section editor).
--
-- Before this, only workouts.benchmark_workout_id existed — but personal
-- /crossfit workouts and gym programming workouts have different shapes:
-- personal workouts are 1:1 with a benchmark (whole workout = Fran), while
-- gym programming workouts contain multiple sections (warm-up + WOD +
-- cool-down) where only the WOD section is the benchmark. Section-level FK
-- captures this without coupling the parent workout to a single benchmark.
--
-- Benchmark history queries union the two: a score links to a benchmark if
-- workouts.benchmark_workout_id matches (personal flow) OR if the score's
-- part.workout_section_id points at a section whose benchmark_workout_id
-- matches (gym programming flow).

alter table workout_sections
  add column if not exists benchmark_workout_id uuid
    references benchmark_workouts(id) on delete set null;

create index if not exists workout_sections_benchmark_workout_id_idx
  on workout_sections (benchmark_workout_id)
  where benchmark_workout_id is not null;
