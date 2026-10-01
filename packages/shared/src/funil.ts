import { z } from "zod";

// Etapas do funil de clientes (tela Funil). A ordem aqui é a ordem das colunas do kanban.
export const ETAPAS_FUNIL = ["em_conversa", "interessado", "fechando", "fechou", "nao_fechou"] as const;
export type EtapaFunil = (typeof ETAPAS_FUNIL)[number];

export const ROTULO_ETAPA_FUNIL: Record<EtapaFunil, string> = {
  em_conversa: "Em conversa",
  interessado: "Interessado",
  fechando: "Fechando",
  fechou: "Fechou",
  nao_fechou: "Não fechou",
};

// Descrições usadas no kanban e no prompt da análise: é o mesmo critério para a equipe e para a IA.
export const DESCRICAO_ETAPA_FUNIL: Record<EtapaFunil, string> = {
  em_conversa: "Respondeu, mas ainda não mostrou interesse claro em se matricular.",
  interessado: "Perguntou de planos, preços ou condições: quer saber mais.",
  fechando: "Escolheu um plano ou pediu para pagar/fechar; falta concluir a matrícula.",
  fechou: "Matrícula concluída.",
  nao_fechou: "Desistiu, recusou ou parou de responder depois de conhecer a oferta.",
};

export const MOTIVOS_PERDA = ["preco", "fidelidade", "localizacao", "horario", "sem_interesse", "sumiu", "ja_aluno", "outro"] as const;
export type MotivoPerda = (typeof MOTIVOS_PERDA)[number];

export const ROTULO_MOTIVO_PERDA: Record<MotivoPerda, string> = {
  preco: "Preço",
  fidelidade: "Fidelidade de 12 meses",
  localizacao: "Localização da unidade",
  horario: "Horário / rotina",
  sem_interesse: "Sem interesse",
  sumiu: "Parou de responder",
  ja_aluno: "Já é aluno / já tem academia",
  outro: "Outro motivo",
};

export const moverNoFunilInputSchema = z.object({
  telefone: z.string().regex(/^\d{10,15}$/),
  numeroId: z.number().int().positive(),
  etapa: z.enum(ETAPAS_FUNIL),
  // Só vale para "nao_fechou"; nas outras etapas é limpo.
  motivoPerda: z.enum(MOTIVOS_PERDA).optional(),
  motivoDetalhe: z.string().trim().max(500).optional(),
});

// Análise diária das conversas pela IA (worker).
export const ANALISE_CONVERSAS_QUEUE_NAME = "analise-conversas";
export const ANALISE_CONVERSAS_JOB_NAME = "analisar";
// Job agendado pelo próprio worker (todo dia de madrugada) e job pedido pela tela ("Analisar agora").
export const ANALISE_DIARIA_SCHEDULER_ID = "analise-diaria";
export interface AnaliseConversasJobData {
  origem: "agendada" | "manual";
}

// Chaves em `configuracoes` onde o worker registra a análise: a tela Funil mostra quando rodou,
// quanto analisou e quanto gastou, e se a IA está disponível (o worker tem a chave da Anthropic).
export const CHAVE_ANALISE_STATUS = "analise.status";
export const CHAVE_ANALISE_DISPONIVEL = "analise.disponivel";

export interface StatusDaAnalise {
  situacao: "rodando" | "concluida" | "falhou";
  origem: "agendada" | "manual";
  inicio: string;
  fim?: string;
  analisadas?: number;
  erros?: number;
  // Conversas com novidade que ficaram para a próxima rodada (limite por rodada).
  restantes?: number;
  tokensEntrada?: number;
  tokensSaida?: number;
  mensagemErro?: string;
}
