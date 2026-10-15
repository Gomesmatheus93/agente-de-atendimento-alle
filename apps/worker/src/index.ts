import type { Worker } from "bullmq";
import { aplicarRetencao, configuracoes, createDbClient } from "@atendimento-academias/db";
import { createDisparoWorker } from "./queue/disparo-queue.js";
import { createMensagemSaidaWorker } from "./queue/mensagem-saida-queue.js";
import { createIaSugestaoWorker } from "./queue/ia-sugestao-queue.js";
import { AgenteAtendimento } from "./ia/agenteAtendimento.js";
import { AnalistaConversas } from "./ia/analistaConversas.js";
import { agendarAnaliseDiaria, createAnaliseConversaWorker, createAnaliseConversasWorker } from "./queue/analise-conversas-queue.js";
import { iniciarAgendadorDeCampanhas } from "./scheduler/campanhas-agendadas.js";
import { agendarColetaInstagram, createInstagramColetaWorker } from "./queue/instagram-coleta-queue.js";
import { FabricaDeProviders } from "./providers/whatsapp/fabrica.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL não configurada");

const db = createDbClient(databaseUrl);
// Cada número cadastrado no painel tem credenciais próprias; a fábrica resolve isso por envio.
const providers = new FabricaDeProviders(db);

const workers: Array<{ nome: string; worker: Worker }> = [
  { nome: "disparo-envio", worker: createDisparoWorker(db, providers) },
  { nome: "mensagem-saida", worker: createMensagemSaidaWorker(db, providers) },
  { nome: "instagram-coleta", worker: createInstagramColetaWorker(db) },
];
void agendarColetaInstagram().catch((erro) => console.error("[instagram] não foi possível agendar a coleta diária:", erro));

// Sem credencial da Anthropic o resto do sistema segue funcionando; os pedidos de sugestão ficam
// na fila e são atendidos quando o worker subir com a chave.
const iaDisponivel = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
if (iaDisponivel) {
  workers.push({ nome: "ia-sugestao", worker: createIaSugestaoWorker(db, new AgenteAtendimento()) });
  const analista = new AnalistaConversas();
  workers.push({ nome: "analise-conversas", worker: createAnaliseConversasWorker(db, analista) });
  workers.push({ nome: "analise-conversa", worker: createAnaliseConversaWorker(db, analista) });
} else {
  console.warn("[ia] ANTHROPIC_API_KEY ausente: a IA de atendimento não vai sugerir respostas e a análise diária das conversas não roda.");
}
void agendarAnaliseDiaria(db, iaDisponivel).catch((erro) => console.error("[analise] não foi possível agendar a análise diária:", erro));

for (const { nome, worker } of workers) {
  worker.on("completed", (job) => {
    console.log(`[worker:${nome}] job ${job.id} concluído`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[worker:${nome}] job ${job?.id} falhou:`, err);
  });
}

iniciarAgendadorDeCampanhas(db);

// Batimento: a tela de saúde do sistema avisa quando o worker para de bater (campanhas e respostas param
// de sair). Só em produção — o worker do computador de desenvolvimento usa o mesmo banco e esconderia
// um worker de produção parado.
const CHAVE_BATIMENTO = "worker.batimento";
function baterCoracao(): void {
  db.insert(configuracoes)
    .values({ unidadeId: null, chave: CHAVE_BATIMENTO, valor: new Date().toISOString() })
    .onConflictDoUpdate({ target: [configuracoes.unidadeId, configuracoes.chave], set: { valor: new Date().toISOString() } })
    .catch((erro: unknown) => console.error("[worker] não foi possível registrar o batimento:", erro));
}
// Retenção (LGPD): com RETENCAO_CONVERSAS_MESES, conversas paradas há mais tempo que isso são apagadas de
// vez, uma vez por dia. Sem a variável, nada é apagado automaticamente.
const mesesDeRetencao = Number(process.env.RETENCAO_CONVERSAS_MESES ?? 0);
if (process.env.NODE_ENV === "production" && Number.isInteger(mesesDeRetencao) && mesesDeRetencao > 0) {
  const reter = () =>
    void aplicarRetencao(db, mesesDeRetencao)
      .then((r) => (r.conversas + r.dms > 0 ? console.log(`[lgpd] retenção de ${mesesDeRetencao} meses: ${r.conversas} conversa(s) e ${r.dms} DM(s) apagadas`) : undefined))
      .catch((erro) => console.error("[lgpd] falha na retenção:", erro));
  setTimeout(reter, 10 * 60_000).unref();
  setInterval(reter, 24 * 60 * 60_000).unref();
}

if (process.env.NODE_ENV === "production") {
  baterCoracao();
  setInterval(baterCoracao, 60_000).unref();
}

console.log(`[worker] escutando filas ${workers.map(({ nome }) => nome).join(", ")}; agendador de campanhas ativo...`);
