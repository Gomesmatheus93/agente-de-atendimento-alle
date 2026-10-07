import type { Worker } from "bullmq";
import { createDbClient } from "@atendimento-academias/db";
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

console.log(`[worker] escutando filas ${workers.map(({ nome }) => nome).join(", ")}; agendador de campanhas ativo...`);
