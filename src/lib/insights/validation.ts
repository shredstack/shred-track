import { z } from "zod";

export const divisionSchema = z.enum(["men_open", "women_open", "men_pro", "women_pro"]);
export const segmentTypeSchema = z.enum(["run", "station", "roxzone"]);
export const eventIdSchema = z.string().uuid().optional();
