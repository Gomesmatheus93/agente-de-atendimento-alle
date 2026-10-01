import { z } from "zod";

export const PERIODOS_DASHBOARD = [7, 14, 30] as const;

export type PeriodoDashboard = (typeof PERIODOS_DASHBOARD)[number];

export const resumoDashboardInputSchema = z.object({
  dias: z.union([z.literal(7), z.literal(14), z.literal(30)]).default(7),
});

export const listarCampanhasInputSchema = z
  .object({
    limite: z.number().int().min(1).max(100).default(50),
  })
  .default({ limite: 50 });
