import { z } from "zod";
import { STANDARD_FORMAT_DIVISION_KEYS, type DivisionKey } from "@/lib/hyrox-data";

export const divisionSchema = z.enum(
  STANDARD_FORMAT_DIVISION_KEYS as [DivisionKey, ...DivisionKey[]],
);
export const segmentTypeSchema = z.enum(["run", "station", "roxzone"]);
export const eventIdSchema = z.string().uuid().optional();
