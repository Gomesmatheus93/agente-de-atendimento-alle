import {
  campanhasDisparo,
  configuracoes,
  contasInstagram,
  contasWhatsapp,
  conversasConfig,
  disparoDestinatarios,
  doNumeroDaUnidade,
  mensagensSaida,
  numerosWhatsapp,
  respostasClientes,
  unidades,
  verificacoesSaude,
  verificarArmazenamento,
  type Db,
  type NivelSaude,
} from "@atendimento-academias/db";
import { and, count, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { configuracaoDoAgente, segredoDoAppDaUnidade, tokenDaConta } from "../config/plataforma.js";
import { configEvo, testarEvo } from "../evo/cliente.js";
import { buscarConta, ErroGraph, listarNumeros } from "../meta/graph.js";
import { pingRedis } from "../queue.js";
import { fetchExterno } from "../rede/urlExterna.js";

// Saúde do sistema: a cada poucos minutos confere cada peça de que o atendimento depende e grava o
// resultado em verificacoes_saude. A tela "Saúde do sistema" e o aviso do topo leem de lá; quando algo
// quebra (token da Meta vencido, n8n fora do ar, fila parada), a equipe fica sabendo antes do cliente.

const INTERVALO_MS = 5 * 60_000;
const BATIMENTO_MAXIMO_MS = 3 * 60_000;

export interface Verificacao {
  chave: string;
  nivel: NivelSaude;
  titulo: string;
  mensagem: string;
  acao?: string;
  link?: string;
}

function textoDoErro(erro: unknown): string {
  return (erro instanceof Error ? erro.message : String(erro)).slice(0, 300);
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

// Grava o resultado de uma rodada. "desde" só muda quando o nível muda; o que não apareceu nesta rodada
// (número desativado, EVO desconectado) sai da lista.
async function gravar(db: Db, unidadeId: number | null, verificacoes: Verificacao[], inicio: Date): Promise<void> {
  for (const v of verificacoes) {
    await db
      .insert(verificacoesSaude)
      .values({ unidadeId, chave: v.chave, nivel: v.nivel, titulo: v.titulo, mensagem: v.mensagem, acao: v.acao ?? null, link: v.link ?? null })
      .onConflictDoUpdate({
        target: [verificacoesSaude.unidadeId, verificacoesSaude.chave],
        set: {
          nivel: v.nivel,
          titulo: v.titulo,
          mensagem: v.mensagem,
          acao: v.acao ?? null,
          link: v.link ?? null,
          verificadoEm: sql`now()`,
          desde: sql`case when ${verificacoesSaude.nivel} = excluded.nivel then ${verificacoesSaude.desde} else now() end`,
        },
      });
  }
  await db
    .delete(verificacoesSaude)
    .where(
      and(
        unidadeId === null ? isNull(verificacoesSaude.unidadeId) : eq(verificacoesSaude.unidadeId, unidadeId),
        lt(verificacoesSaude.verificadoEm, inicio),
      ),
    );
}

async function verificarWhatsapp(db: Db, unidadeId: number): Promise<Verificacao[]> {
  const contas = await db.select().from(contasWhatsapp).where(eq(contasWhatsapp.unidadeId, unidadeId));
  if (contas.length === 0) {
    return [
      {
        chave: "whatsapp",
        nivel: "falha",
        titulo: "WhatsApp não conectado",
        mensagem: "A unidade ainda não tem conta do WhatsApp cadastrada: não dá para disparar nem atender.",
        acao: "Cadastre a conta (WABA) e o token em Configurações.",
        link: "#/configuracoes",
      },
    ];
  }

  const resultado: Verificacao[] = [];
  const numeros = await db.select().from(numerosWhatsapp).where(and(eq(numerosWhatsapp.unidadeId, unidadeId), eq(numerosWhatsapp.ativo, true)));
  if (numeros.length === 0) {
    resultado.push({
      chave: "whatsapp.numeros",
      nivel: "falha",
      titulo: "Nenhum número ativo",
      mensagem: "Há conta do WhatsApp cadastrada, mas nenhum número está marcado como ativo.",
      acao: "Ative o número da unidade em Configurações.",
      link: "#/configuracoes",
    });
  }

  for (const conta of contas) {
    const chave = `whatsapp.conta.${conta.id}`;
    try {
      const token = await tokenDaConta(db, conta.id);
      await buscarConta(conta.wabaId, token);
      const daMeta = await listarNumeros(conta.wabaId, token);
      resultado.push({ chave, nivel: "ok", titulo: `Conta ${conta.nome}`, mensagem: "A Meta aceitou o token da conta." });

      for (const numero of numeros.filter((n) => n.contaId === conta.id)) {
        const remoto = daMeta.find((n) => n.id === numero.phoneNumberId);
        const qualidade = remoto?.quality_rating?.toUpperCase() ?? null;
        if (qualidade && qualidade !== numero.qualidade) {
          await db.update(numerosWhatsapp).set({ qualidade }).where(eq(numerosWhatsapp.id, numero.id));
        }
        const titulo = `Número ${numero.numeroExibicao}`;
        const chaveNumero = `whatsapp.numero.${numero.id}`;
        if (!remoto) {
          resultado.push({
            chave: chaveNumero,
            nivel: "falha",
            titulo,
            mensagem: "A Meta não lista mais este número na conta.",
            acao: "Confira o número no Gerenciador do WhatsApp e em Configurações.",
            link: "#/configuracoes",
          });
        } else if (qualidade === "RED") {
          resultado.push({
            chave: chaveNumero,
            nivel: "falha",
            titulo,
            mensagem: "Qualidade BAIXA na Meta: muitos clientes bloquearam ou denunciaram. O limite de envio pode cair ou o número ser restringido.",
            acao: "Pause campanhas por alguns dias, envie só para quem pediu e reveja os templates.",
            link: "#/campanhas",
          });
        } else if (qualidade === "YELLOW") {
          resultado.push({
            chave: chaveNumero,
            nivel: "atencao",
            titulo,
            mensagem: "Qualidade MÉDIA na Meta: alguns clientes estão bloqueando ou denunciando.",
            acao: "Diminua a frequência das campanhas e confira se a lista de quem pediu para sair está sendo respeitada.",
            link: "#/campanhas",
          });
        } else {
          resultado.push({ chave: chaveNumero, nivel: "ok", titulo, mensagem: qualidade ? "Qualidade ALTA na Meta." : "Número ativo na Meta." });
        }
      }
    } catch (erro) {
      const tokenRecusado = erro instanceof ErroGraph && (erro.codigo === 190 || erro.status === 401);
      resultado.push({
        chave,
        nivel: "falha",
        titulo: `Conta ${conta.nome}`,
        mensagem: tokenRecusado
          ? "A Meta recusou o token: ele venceu ou foi revogado. Campanhas e respostas não saem."
          : `Não foi possível falar com a Meta: ${textoDoErro(erro)}`,
        acao: tokenRecusado ? "Gere um token permanente novo (usuário do sistema) e atualize em Configurações." : "Se continuar, confira o token e o ID da conta em Configurações.",
        link: "#/configuracoes",
      });
    }
  }

  // Sem o segredo do app, em produção o webhook recusa tudo o que a Meta manda (mensagens e checks).
  if (!(await segredoDoAppDaUnidade(db, unidadeId))) {
    resultado.push({
      chave: "whatsapp.webhook",
      nivel: process.env.NODE_ENV === "production" ? "falha" : "atencao",
      titulo: "Recebimento de mensagens",
      mensagem: "Falta a chave secreta do app da Meta: as mensagens dos clientes são recusadas ao chegar.",
      acao: "Preencha a chave secreta do app em Configurações → Webhook.",
      link: "#/configuracoes",
    });
  } else {
    resultado.push({ chave: "whatsapp.webhook", nivel: "ok", titulo: "Recebimento de mensagens", mensagem: "Webhook configurado." });
  }
  return resultado;
}

async function verificarAgente(db: Db, unidadeId: number): Promise<Verificacao[]> {
  const { modo, webhookN8nUrl } = await configuracaoDoAgente(db, unidadeId);
  if (modo === "interno") {
    const temChave = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
    return [
      temChave
        ? { chave: "agente", nivel: "ok", titulo: "IA de atendimento", mensagem: "Agente interno pronto para sugerir respostas." }
        : {
            chave: "agente",
            nivel: "falha",
            titulo: "IA de atendimento",
            mensagem: "O agente interno está escolhido, mas o servidor não tem a chave da Anthropic: nenhuma sugestão é gerada.",
            acao: "Configure ANTHROPIC_API_KEY no servidor ou passe o agente para o n8n em Configurações.",
            link: "#/configuracoes",
          },
    ];
  }

  if (!webhookN8nUrl) {
    return [
      {
        chave: "agente",
        nivel: "falha",
        titulo: "Bot (n8n)",
        mensagem: "O bot está no modo n8n, mas sem endereço do webhook: ninguém responde os clientes automaticamente.",
        acao: "Cole a URL do webhook do n8n em Configurações → Agente.",
        link: "#/configuracoes",
      },
    ];
  }

  const resultado: Verificacao[] = [];
  // /healthz é do próprio n8n: confere que ele está no ar sem disparar o fluxo.
  try {
    const resposta = await fetchExterno(`${new URL(webhookN8nUrl).origin}/healthz`, { signal: AbortSignal.timeout(10_000) });
    resultado.push(
      resposta.ok
        ? { chave: "agente", nivel: "ok", titulo: "Bot (n8n)", mensagem: "O n8n está no ar." }
        : {
            chave: "agente",
            nivel: "falha",
            titulo: "Bot (n8n)",
            mensagem: `O n8n respondeu com erro (HTTP ${resposta.status}): o bot pode não estar respondendo.`,
            acao: "Abra o n8n e confira se o serviço está de pé e o fluxo ativo.",
          },
    );
  } catch (erro) {
    resultado.push({
      chave: "agente",
      nivel: "falha",
      titulo: "Bot (n8n)",
      mensagem: `O n8n não respondeu (${textoDoErro(erro)}): os clientes ficam sem resposta automática.`,
      acao: "Confira no easypanel se o serviço do n8n está rodando.",
    });
  }

  // O n8n no ar não garante que o fluxo responde (nó com erro, fluxo desativado). Conversa com o bot ligado
  // em que o cliente escreveu há mais de 10 minutos e nada saiu depois = o bot não respondeu.
  const [semResposta] = await db
    .select({ total: count() })
    .from(conversasConfig)
    .where(
      and(
        doNumeroDaUnidade(conversasConfig.numeroId, unidadeId),
        eq(conversasConfig.iaAtiva, true),
        eq(conversasConfig.iaDesligadaManual, false),
        eq(conversasConfig.precisaHumano, false),
        sql`(
          select max(${respostasClientes.recebidaEm}) from ${respostasClientes}
          where ${respostasClientes.telefone} = ${conversasConfig.telefone} and ${respostasClientes.numeroId} = ${conversasConfig.numeroId}
        ) between now() - interval '6 hours' and now() - interval '10 minutes'`,
        sql`not exists (
          select 1 from ${mensagensSaida}
          where ${mensagensSaida.telefone} = ${conversasConfig.telefone} and ${mensagensSaida.numeroId} = ${conversasConfig.numeroId}
            and ${mensagensSaida.createdAt} >= (
              select max(${respostasClientes.recebidaEm}) from ${respostasClientes}
              where ${respostasClientes.telefone} = ${conversasConfig.telefone} and ${respostasClientes.numeroId} = ${conversasConfig.numeroId}
            )
        )`,
      ),
    );
  const total = Number(semResposta?.total ?? 0);
  resultado.push(
    total === 0
      ? { chave: "agente.respostas", nivel: "ok", titulo: "Respostas do bot", mensagem: "Nenhum cliente esperando resposta do bot." }
      : {
          chave: "agente.respostas",
          nivel: total >= 3 ? "falha" : "atencao",
          titulo: "Respostas do bot",
          mensagem: `${plural(total, "cliente escreveu", "clientes escreveram")} há mais de 10 minutos e o bot não respondeu.`,
          acao: "Veja as execuções com erro no n8n e responda essas conversas pelo painel.",
          link: "#/conversas",
        },
  );
  return resultado;
}

async function verificarEnvios(db: Db, unidadeId: number): Promise<Verificacao[]> {
  const resultado: Verificacao[] = [];
  const [presas] = await db
    .select({ total: count() })
    .from(mensagensSaida)
    .where(
      and(
        doNumeroDaUnidade(mensagensSaida.numeroId, unidadeId),
        eq(mensagensSaida.statusEnvio, "pendente"),
        lt(mensagensSaida.createdAt, sql`now() - interval '10 minutes'`),
      ),
    );
  const totalPresas = Number(presas?.total ?? 0);
  resultado.push(
    totalPresas === 0
      ? { chave: "envios.fila", nivel: "ok", titulo: "Fila de respostas", mensagem: "As respostas estão saindo." }
      : {
          chave: "envios.fila",
          nivel: "falha",
          titulo: "Fila de respostas",
          mensagem: `${plural(totalPresas, "resposta está parada", "respostas estão paradas")} há mais de 10 minutos sem sair.`,
          acao: "O worker pode estar parado: reinicie o serviço no easypanel.",
        },
  );

  const [falhas] = await db
    .select({ total: count() })
    .from(mensagensSaida)
    .where(
      and(
        doNumeroDaUnidade(mensagensSaida.numeroId, unidadeId),
        eq(mensagensSaida.statusEnvio, "falhou"),
        gte(mensagensSaida.createdAt, sql`now() - interval '24 hours'`),
      ),
    );
  const totalFalhas = Number(falhas?.total ?? 0);
  resultado.push(
    totalFalhas === 0
      ? { chave: "envios.falhas", nivel: "ok", titulo: "Respostas com falha", mensagem: "Nenhuma resposta falhou nas últimas 24h." }
      : {
          chave: "envios.falhas",
          nivel: totalFalhas >= 5 ? "falha" : "atencao",
          titulo: "Respostas com falha",
          mensagem: `${plural(totalFalhas, "resposta não saiu", "respostas não saíram")} nas últimas 24h.`,
          acao: "Abra as conversas marcadas em vermelho para ver o motivo e reenviar.",
          link: "#/conversas",
        },
  );

  // Campanhas das últimas 24h: muita falha costuma ser template pausado, número sem saldo ou lista ruim.
  const [campanhas] = await db
    .select({
      total: count(),
      falhas: sql<number>`count(*) filter (where ${disparoDestinatarios.statusEnvio} = 'falhou')`,
    })
    .from(disparoDestinatarios)
    .innerJoin(campanhasDisparo, eq(campanhasDisparo.id, disparoDestinatarios.campanhaId))
    .where(and(eq(campanhasDisparo.unidadeId, unidadeId), gte(disparoDestinatarios.updatedAt, sql`now() - interval '24 hours'`)));
  const totalDisparos = Number(campanhas?.total ?? 0);
  const falhasDisparo = Number(campanhas?.falhas ?? 0);
  const taxa = totalDisparos > 0 ? falhasDisparo / totalDisparos : 0;
  resultado.push(
    falhasDisparo >= 5 && taxa >= 0.2
      ? {
          chave: "campanhas.falhas",
          nivel: taxa >= 0.5 ? "falha" : "atencao",
          titulo: "Campanhas",
          mensagem: `${Math.round(taxa * 100)}% dos envios de campanha falharam nas últimas 24h (${falhasDisparo} de ${totalDisparos}).`,
          acao: "Abra a campanha para ver o motivo das falhas (template pausado, limite da Meta, números inválidos).",
          link: "#/campanhas",
        }
      : {
          chave: "campanhas.falhas",
          nivel: "ok",
          titulo: "Campanhas",
          mensagem: totalDisparos > 0 ? `${totalDisparos - falhasDisparo} de ${totalDisparos} envios das últimas 24h saíram.` : "Nenhum envio de campanha nas últimas 24h.",
        },
  );
  return resultado;
}

async function verificarEvo(db: Db, unidadeId: number): Promise<Verificacao[]> {
  const config = await configEvo(db, unidadeId);
  if (!config) return [];
  try {
    await testarEvo(config);
    return [{ chave: "evo", nivel: "ok", titulo: "EVO", mensagem: "O EVO está respondendo." }];
  } catch (erro) {
    return [
      {
        chave: "evo",
        nivel: "falha",
        titulo: "EVO",
        mensagem: `O EVO não respondeu (${textoDoErro(erro)}): o bot não sabe quem é aluno e não cadastra leads.`,
        acao: "Confira o DNS e a chave da API em Configurações → EVO.",
        link: "#/configuracoes",
      },
    ];
  }
}

async function verificarInstagram(db: Db, unidadeId: number): Promise<Verificacao[]> {
  const [conta] = await db.select().from(contasInstagram).where(eq(contasInstagram.unidadeId, unidadeId));
  if (!conta) return [];
  const titulo = `Instagram @${conta.username}`;
  if (conta.erroColeta) {
    return [{ chave: "instagram", nivel: "falha", titulo, mensagem: conta.erroColeta, acao: "Conecte o Instagram de novo na tela Instagram.", link: "#/instagram" }];
  }
  const diasParaVencer = conta.tokenExpiraEm ? (conta.tokenExpiraEm.getTime() - Date.now()) / 86_400_000 : null;
  if (diasParaVencer !== null && diasParaVencer < 7) {
    return [
      {
        chave: "instagram",
        nivel: diasParaVencer < 0 ? "falha" : "atencao",
        titulo,
        mensagem: diasParaVencer < 0 ? "O acesso ao Instagram venceu." : `O acesso ao Instagram vence em ${Math.max(1, Math.round(diasParaVencer))} dia(s) e não foi renovado.`,
        acao: "Conecte o Instagram de novo na tela Instagram.",
        link: "#/instagram",
      },
    ];
  }
  return [{ chave: "instagram", nivel: "ok", titulo, mensagem: "Conectado." }];
}

export async function verificarUnidade(db: Db, unidadeId: number): Promise<void> {
  const inicio = new Date(Date.now() - 1000);
  const partes = await Promise.all(
    [verificarWhatsapp, verificarAgente, verificarEnvios, verificarEvo, verificarInstagram].map((verificar) =>
      verificar(db, unidadeId).catch((erro): Verificacao[] => {
        console.error(`[saude] verificação ${verificar.name} da unidade ${unidadeId} falhou:`, erro);
        return [];
      }),
    ),
  );
  await gravar(db, unidadeId, partes.flat(), inicio);
}

// Peças da plataforma (uma para todas as unidades). Só faz sentido onde roda a produção: no computador
// de desenvolvimento (mesmo banco) o worker, o Redis e o armazenamento são outros.
export async function verificarPlataforma(db: Db): Promise<void> {
  const inicio = new Date(Date.now() - 1000);
  const resultado: Verificacao[] = [];

  const [batimento] = await db
    .select({ valor: configuracoes.valor })
    .from(configuracoes)
    .where(and(isNull(configuracoes.unidadeId), eq(configuracoes.chave, "worker.batimento")));
  const ultimo = batimento ? new Date(batimento.valor).getTime() : 0;
  resultado.push(
    Date.now() - ultimo < BATIMENTO_MAXIMO_MS
      ? { chave: "worker", nivel: "ok", titulo: "Worker (envios)", mensagem: "O worker está rodando." }
      : {
          chave: "worker",
          nivel: "falha",
          titulo: "Worker (envios)",
          mensagem: ultimo ? "O worker parou: campanhas e respostas não estão saindo." : "O worker ainda não deu sinal de vida.",
          acao: "Reinicie o serviço no easypanel e veja o log do worker.",
        },
  );

  try {
    await pingRedis();
    resultado.push({ chave: "redis", nivel: "ok", titulo: "Fila (Redis)", mensagem: "O Redis está respondendo." });
  } catch (erro) {
    resultado.push({
      chave: "redis",
      nivel: "falha",
      titulo: "Fila (Redis)",
      mensagem: `O Redis não respondeu (${textoDoErro(erro)}): nada entra na fila de envio.`,
      acao: "Confira o serviço do Redis no easypanel.",
    });
  }

  try {
    const bucket = await verificarArmazenamento();
    resultado.push(
      bucket
        ? { chave: "armazenamento", nivel: "ok", titulo: "Arquivos (S3)", mensagem: `Bucket ${bucket} acessível.` }
        : {
            chave: "armazenamento",
            nivel: "atencao",
            titulo: "Arquivos",
            mensagem: "Os arquivos (áudios, fotos, documentos) estão no disco do servidor e somem a cada nova versão.",
            acao: "Configure S3_BUCKET, S3_REGION e as chaves da AWS no easypanel.",
          },
    );
  } catch (erro) {
    resultado.push({
      chave: "armazenamento",
      nivel: "falha",
      titulo: "Arquivos (S3)",
      mensagem: `O S3 recusou o acesso (${textoDoErro(erro)}): áudios, fotos e documentos não são guardados.`,
      acao: "Confira o nome do bucket, a região e as chaves da AWS no easypanel.",
    });
  }

  await gravar(db, null, resultado, inicio);
}

export async function verificarTudo(db: Db): Promise<void> {
  await verificarPlataforma(db).catch((erro) => console.error("[saude] verificação da plataforma falhou:", erro));
  const ativas = await db.select({ id: unidades.id }).from(unidades).where(eq(unidades.ativo, true));
  for (const { id } of ativas) await verificarUnidade(db, id);
}

// Ligado em produção (ou com SAUDE_MONITOR=1). O primeiro ciclo espera o worker ter tempo de bater.
export function monitorLigado(): boolean {
  return process.env.SAUDE_MONITOR ? process.env.SAUDE_MONITOR === "1" : process.env.NODE_ENV === "production";
}

export function iniciarMonitorDeSaude(db: Db): void {
  if (!monitorLigado()) return;
  const rodar = () => void verificarTudo(db).catch((erro) => console.error("[saude] rodada falhou:", erro));
  setTimeout(rodar, 90_000).unref();
  setInterval(rodar, INTERVALO_MS).unref();
}
