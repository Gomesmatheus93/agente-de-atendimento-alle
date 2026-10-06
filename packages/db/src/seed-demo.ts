import { extrairPlaceholders, precoDaCategoria } from "@atendimento-academias/shared";
import { and, eq, inArray, like } from "drizzle-orm";
import { createDbClient } from "./client.js";
import { campanhasDisparo, disparoDestinatarios, respostasClientes, templatesWhatsapp } from "./schema/index.js";

const PREFIXO_DEMO = "[Demo] ";
const DIA_MS = 86_400_000;
const CHUNK = 500;

const CAMPANHAS: Array<{ nome: string; diasAtras: number; destinatarios: number; taxaFalha: number; taxaResposta: number }> = [
  { nome: "Boas-vindas turma da manhã", diasAtras: 0, destinatarios: 64, taxaFalha: 0.06, taxaResposta: 0.12 },
  { nome: "Promoção de renovação", diasAtras: 0, destinatarios: 118, taxaFalha: 0.11, taxaResposta: 0.24 },
  { nome: "Aviso de horário de feriado", diasAtras: 1, destinatarios: 92, taxaFalha: 0.04, taxaResposta: 0.18 },
  { nome: "Campanha de retorno", diasAtras: 2, destinatarios: 45, taxaFalha: 0.22, taxaResposta: 0.09 },
  { nome: "Boas-vindas novos alunos", diasAtras: 2, destinatarios: 30, taxaFalha: 0.03, taxaResposta: 0.3 },
  { nome: "Desconto semestral", diasAtras: 3, destinatarios: 110, taxaFalha: 0.08, taxaResposta: 0.27 },
  { nome: "Pesquisa de satisfação", diasAtras: 4, destinatarios: 76, taxaFalha: 0.13, taxaResposta: 0.16 },
  { nome: "Aula experimental", diasAtras: 6, destinatarios: 58, taxaFalha: 0.05, taxaResposta: 0.34 },
  { nome: "Renovação de plano anual", diasAtras: 7, destinatarios: 101, taxaFalha: 0.09, taxaResposta: 0.22 },
  { nome: "Volta às aulas", diasAtras: 9, destinatarios: 85, taxaFalha: 0.07, taxaResposta: 0.2 },
  { nome: "Indique um amigo", diasAtras: 11, destinatarios: 49, taxaFalha: 0.16, taxaResposta: 0.08 },
  { nome: "Boas-vindas turma da noite", diasAtras: 13, destinatarios: 38, taxaFalha: 0.05, taxaResposta: 0.14 },
];

// Mensagens que clientes mandariam de volta; as repetições dão peso aos assuntos mais comuns no ranking.
const NOMES = ["Ana", "Bruno", "Carla", "Diego", "Eduarda", "Felipe", "Gabriela", "Henrique", "Isabela", "João", "Karen", "Lucas", "Mariana", "Nicolas", "Paula", "Rafael", "Sofia", "Thiago"];

// Contatos que escrevem por conta própria, sem ter recebido nenhum disparo (não entram em campanha alguma).
const PREFIXO_TELEFONE_ESPONTANEO = "551198888";
const CONTATOS_ESPONTANEOS = [
  { mensagens: ["Oi, boa tarde!", "Vocês têm plano família?"], minutosAtras: 25 },
  { mensagens: ["Bom dia, qual o endereço da unidade do centro?"], minutosAtras: 140 },
  { mensagens: ["Quero cancelar minha matrícula, como faço?", "Pode ser por aqui mesmo?"], minutosAtras: 60 * 30 },
];

// Segunda ou terceira mensagem de quem já respondeu, para as conversas não terem sempre uma linha só.
const FOLLOWUPS = ["Ok, obrigado!", "Perfeito, vou passar aí hoje", "Pode me ligar mais tarde?", "Consegue me mandar por aqui mesmo?", "Beleza, valeu!", "Até que horas vocês ficam abertos?"];

const MENSAGENS_CLIENTES = [
  "Qual o valor da mensalidade?",
  "Qual o valor da mensalidade?",
  "Quanto custa o plano anual?",
  "Tem desconto para estudante?",
  "Quanto custa o plano anual?",
  "Que horas a academia abre no sábado?",
  "Vocês abrem no feriado?",
  "Qual o horário de funcionamento?",
  "Qual o horário de funcionamento?",
  "Quero fazer uma aula experimental",
  "Como faço a matrícula?",
  "Posso agendar uma aula experimental?",
  "Como faço para cancelar meu plano?",
  "Quero trancar minha matrícula por 2 meses",
  "Preciso da segunda via do boleto",
  "Meu boleto venceu, como pago?",
  "Aceita pix?",
  "Quero renovar meu plano",
  "Como renovo com o desconto?",
  "Tem aula de spinning à noite?",
  "Tem musculação e pilates?",
  "Qual o professor da turma da manhã?",
  "Onde fica a unidade mais próxima?",
  "Tem estacionamento?",
  "Vocês têm alguma unidade no centro?",
  "ok",
  "obrigado!",
  "Tudo bem, valeu",
  "Pode me ligar mais tarde?",
  "Quando vocês vão ter horário livre?",
];

const MOTIVOS_FALHA = [
  "Número não possui WhatsApp",
  "Número não possui WhatsApp",
  "Número não possui WhatsApp",
  "Limite de envio excedido (rate limit)",
  "Limite de envio excedido (rate limit)",
  "Telefone bloqueou o remetente",
  "Template não aprovado pelo agregador",
];

// Mensagens de mais de um dia já foram vistas; as recentes ficam, em parte, como não lidas.
function lidaEmDaDemo(recebidaEm: Date, agora: number): Date | null {
  const idadeMs = agora - recebidaEm.getTime();
  if (idadeMs > 26 * 3_600_000 || aleatorio() < 0.35) return new Date(recebidaEm.getTime() + 20 * 60_000);
  return null;
}

// Campanhas ainda não disparadas, com data futura: aparecem no calendário como "agendadas".
const AGENDADAS: Array<{ nome: string; diasAFrente: number; hora: number; minuto: number; destinatarios: number }> = [
  { nome: "Promoção de aniversário da academia", diasAFrente: 1, hora: 9, minuto: 0, destinatarios: 120 },
  { nome: "Aviso de manutenção da piscina", diasAFrente: 1, hora: 15, minuto: 0, destinatarios: 40 },
  { nome: "Lembrete de avaliação física", diasAFrente: 3, hora: 18, minuto: 30, destinatarios: 85 },
  { nome: "Renovação de outubro", diasAFrente: 8, hora: 10, minuto: 0, destinatarios: 200 },
  { nome: "Boas-vindas turma de novembro", diasAFrente: 14, hora: 8, minuto: 30, destinatarios: 60 },
];

async function criarAgendadas(db: ReturnType<typeof createDbClient>, templates: Array<typeof templatesWhatsapp.$inferSelect>): Promise<void> {
  let contador = 0;

  for (const [indice, agendada] of AGENDADAS.entries()) {
    const template = templates[indice % templates.length]!;
    const placeholders = extrairPlaceholders(template.conteudo);

    const disparoEm = new Date();
    disparoEm.setDate(disparoEm.getDate() + agendada.diasAFrente);
    disparoEm.setHours(agendada.hora, agendada.minuto, 0, 0);

    const [{ id: campanhaId }] = await db
      .insert(campanhasDisparo)
      .values({
        nome: `${PREFIXO_DEMO}${agendada.nome}`,
        unidadeId: template.unidadeId,
        templateId: template.id,
        status: "agendada",
        custoUnitario: precoDaCategoria(template.categoria).toFixed(4),
        disparoEm,
      })
      .returning({ id: campanhasDisparo.id });

    const linhas = Array.from({ length: agendada.destinatarios }, () => {
      contador += 1;
      const nome = NOMES[contador % NOMES.length]!;
      return {
        campanhaId,
        telefone: `55119${String(80_000_000 + (indice + 1) * 10_000 + contador * 37).padStart(8, "0")}`,
        parametros: Object.fromEntries(placeholders.map((chave) => [chave, chave === "desconto" ? "20%" : nome])),
      };
    });

    for (let i = 0; i < linhas.length; i += CHUNK) {
      await db.insert(disparoDestinatarios).values(linhas.slice(i, i + CHUNK));
    }
  }

  console.log(`[seed-demo] ${AGENDADAS.length} campanhas agendadas de demonstração criadas`);
}

let semente = 42;
function aleatorio(): number {
  semente = (semente * 1664525 + 1013904223) % 4294967296;
  return semente / 4294967296;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não configurada");
  const db = createDbClient(databaseUrl);

  const existentes = await db
    .select({ id: campanhasDisparo.id })
    .from(campanhasDisparo)
    .where(like(campanhasDisparo.nome, `${PREFIXO_DEMO}%`));

  if (process.argv.includes("--limpar")) {
    const ids = existentes.map((campanha) => campanha.id);
    if (ids.length > 0) {
      await db.delete(respostasClientes).where(inArray(respostasClientes.campanhaId, ids));
      await db.delete(respostasClientes).where(like(respostasClientes.telefone, `${PREFIXO_TELEFONE_ESPONTANEO}%`));
      await db.delete(disparoDestinatarios).where(inArray(disparoDestinatarios.campanhaId, ids));
      await db.delete(campanhasDisparo).where(inArray(campanhasDisparo.id, ids));
    }
    console.log(`[seed-demo] ${ids.length} campanha(s) de demonstração removida(s)`);
    return;
  }

  if (process.argv.includes("--so-agendadas")) {
    const jaTem = await db
      .select({ id: campanhasDisparo.id })
      .from(campanhasDisparo)
      .where(and(like(campanhasDisparo.nome, `${PREFIXO_DEMO}%`), eq(campanhasDisparo.status, "agendada")));
    if (jaTem.length > 0) {
      console.log("[seed-demo] já existem campanhas agendadas de demonstração; nada a fazer");
      return;
    }
    const ativos = await db.select().from(templatesWhatsapp).where(eq(templatesWhatsapp.ativo, true));
    if (ativos.length === 0) throw new Error("Nenhum template ativo. Rode `pnpm db:seed` primeiro.");
    await criarAgendadas(db, ativos);
    return;
  }

  if (existentes.length > 0) {
    console.log("[seed-demo] já existem campanhas de demonstração; use --limpar para removê-las antes de recriar, ou --so-agendadas para só adicionar as agendadas");
    return;
  }

  const templates = await db.select().from(templatesWhatsapp).where(eq(templatesWhatsapp.ativo, true));
  if (templates.length === 0) {
    throw new Error("Nenhum template ativo. Rode `pnpm db:seed` primeiro.");
  }

  let contadorTelefone = 0;
  const agora = Date.now();

  // Do mais antigo ao mais novo, para o id crescer junto com a data de criação.
  for (const [indice, campanha] of [...CAMPANHAS].reverse().entries()) {
    const template = templates[indice % templates.length]!;
    const placeholders = extrairPlaceholders(template.conteudo);

    const criadaEm = new Date(agora - campanha.diasAtras * DIA_MS);
    criadaEm.setHours(8 + Math.floor(aleatorio() * 11), Math.floor(aleatorio() * 60), 0, 0);
    if (criadaEm.getTime() > agora) criadaEm.setTime(agora - 30 * 60_000);

    const [{ id: campanhaId }] = await db
      .insert(campanhasDisparo)
      .values({
        nome: `${PREFIXO_DEMO}${campanha.nome}`,
        unidadeId: template.unidadeId,
        templateId: template.id,
        status: "concluida",
        custoUnitario: precoDaCategoria(template.categoria).toFixed(4),
        disparoEm: criadaEm,
        createdAt: criadaEm,
        updatedAt: criadaEm,
      })
      .returning({ id: campanhasDisparo.id });

    const linhas = Array.from({ length: campanha.destinatarios }, () => {
      contadorTelefone += 1;
      const falhou = aleatorio() < campanha.taxaFalha;
      const enviadoEm = new Date(criadaEm.getTime() + 2_000 + Math.floor(aleatorio() * 90_000));
      const nome = NOMES[contadorTelefone % NOMES.length]!;
      const parametros = Object.fromEntries(placeholders.map((chave) => [chave, chave === "desconto" ? "20%" : nome]));

      return {
        campanhaId,
        telefone: `55119${String(70_000_000 + contadorTelefone * 37).padStart(8, "0")}`,
        parametros,
        statusEnvio: falhou ? ("falhou" as const) : ("enviado" as const),
        tentativas: 1,
        erroDetalhe: falhou ? MOTIVOS_FALHA[Math.floor(aleatorio() * MOTIVOS_FALHA.length)]! : null,
        enviadoEm: falhou ? null : enviadoEm,
        createdAt: criadaEm,
        updatedAt: enviadoEm,
      };
    });

    for (let i = 0; i < linhas.length; i += CHUNK) {
      await db.insert(disparoDestinatarios).values(linhas.slice(i, i + CHUNK));
    }

    const enviados = await db
      .select({ id: disparoDestinatarios.id, telefone: disparoDestinatarios.telefone, enviadoEm: disparoDestinatarios.enviadoEm })
      .from(disparoDestinatarios)
      .where(and(eq(disparoDestinatarios.campanhaId, campanhaId), eq(disparoDestinatarios.statusEnvio, "enviado")));

    const respostas = enviados
      .filter(() => aleatorio() < campanha.taxaResposta)
      .flatMap((destinatario) => {
        const primeira = (destinatario.enviadoEm ?? criadaEm).getTime() + 60_000 + Math.floor(aleatorio() * 6 * 3_600_000);
        const textos = [MENSAGENS_CLIENTES[Math.floor(aleatorio() * MENSAGENS_CLIENTES.length)]!];
        // Parte dos clientes continua a conversa com mais uma ou duas mensagens.
        if (aleatorio() < 0.3) textos.push(FOLLOWUPS[Math.floor(aleatorio() * FOLLOWUPS.length)]!);
        if (aleatorio() < 0.08) textos.push(FOLLOWUPS[Math.floor(aleatorio() * FOLLOWUPS.length)]!);

        return textos.map((texto, ordem) => {
          const recebidaEm = new Date(primeira + ordem * (2 + Math.floor(aleatorio() * 88)) * 60_000);
          return {
            telefone: destinatario.telefone,
            campanhaId,
            destinatarioId: destinatario.id,
            texto,
            recebidaEm,
            lidaEm: lidaEmDaDemo(recebidaEm, agora),
          };
        });
      })
      // Respostas "do futuro" (campanhas de hoje) não existem: descarta o que passaria do momento atual.
      .filter((resposta) => resposta.recebidaEm.getTime() <= agora);

    for (let i = 0; i < respostas.length; i += CHUNK) {
      await db.insert(respostasClientes).values(respostas.slice(i, i + CHUNK));
    }
  }

  await criarAgendadas(db, templates);

  const espontaneas = CONTATOS_ESPONTANEOS.flatMap((contato, indice) =>
    contato.mensagens.map((texto, ordem) => ({
      telefone: `${PREFIXO_TELEFONE_ESPONTANEO}${String(indice + 1).padStart(4, "0")}`,
      campanhaId: null,
      destinatarioId: null,
      texto,
      recebidaEm: new Date(agora - contato.minutosAtras * 60_000 + ordem * 90_000),
      lidaEm: null,
    })),
  );
  await db.insert(respostasClientes).values(espontaneas);

  console.log(`[seed-demo] ${CAMPANHAS.length} campanhas de demonstração criadas (nomes iniciam com "${PREFIXO_DEMO.trim()}")`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed-demo] falhou:", err);
    process.exit(1);
  });
