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

// Períodos da Visão geral. "personalizado" usa inicio/fim (dias no fuso da operação, YYYY-MM-DD).
export const PERIODOS_VISAO = ["hoje", "ontem", "7d", "30d", "90d", "1a", "tudo", "personalizado"] as const;
export type PeriodoVisao = (typeof PERIODOS_VISAO)[number];

export const ROTULO_PERIODO_VISAO: Record<PeriodoVisao, string> = {
  hoje: "Hoje",
  ontem: "Ontem",
  "7d": "7 dias",
  "30d": "30 dias",
  "90d": "90 dias",
  "1a": "1 ano",
  tudo: "Todo período",
  personalizado: "Escolher datas",
};

const diaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");

export const resumoVisaoInputSchema = z
  .object({
    periodo: z.enum(PERIODOS_VISAO),
    inicio: diaSchema.optional(),
    fim: diaSchema.optional(),
  })
  .refine((entrada) => entrada.periodo !== "personalizado" || (entrada.inicio && entrada.fim && entrada.inicio <= entrada.fim), {
    message: "Escolha a data de início e a de fim (o início não pode ser depois do fim).",
  });

export type ResumoVisaoInput = z.infer<typeof resumoVisaoInputSchema>;

// Insights das campanhas (tela Campanhas → Insights).
export const PERIODOS_INSIGHTS = [7, 30, 90] as const;
export type PeriodoInsights = (typeof PERIODOS_INSIGHTS)[number];
export const insightsCampanhasInputSchema = z.object({
  dias: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
});

export const insightsInstagramInputSchema = z.object({
  dias: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
});
