import { z } from "zod";

// Intervalo [inicio, fim) das datas de disparo que a tela do calendário quer ver.
const MAX_DIAS_NO_CALENDARIO = 70;

export const calendarioInputSchema = z
  .object({
    inicio: z.string().datetime(),
    fim: z.string().datetime(),
  })
  .refine(({ inicio, fim }) => new Date(fim) > new Date(inicio), { message: "O fim deve ser depois do início" })
  .refine(({ inicio, fim }) => (new Date(fim).getTime() - new Date(inicio).getTime()) / 86_400_000 <= MAX_DIAS_NO_CALENDARIO, {
    message: `Escolha no máximo ${MAX_DIAS_NO_CALENDARIO} dias por vez`,
  });
