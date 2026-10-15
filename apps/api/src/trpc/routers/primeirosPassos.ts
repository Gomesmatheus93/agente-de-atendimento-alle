import {
  campanhasDisparo,
  contasInstagram,
  contatosUnidade,
  numerosWhatsapp,
  respostasClientes,
  templatesWhatsapp,
  usuarios,
  doNumeroDaUnidade,
} from "@atendimento-academias/db";
import { and, count, eq, ne } from "drizzle-orm";
import { configuracaoDoAgente, segredoDoAppDaUnidade } from "../../config/plataforma.js";
import { configEvo } from "../../evo/cliente.js";
import { procedimentoUnidade, router } from "../trpc.js";

// Primeiros passos de uma unidade nova: o que já está pronto, calculado dos dados (não é marcado à mão).
// Some da Visão geral quando os obrigatórios ficam prontos.
export interface Passo {
  chave: string;
  titulo: string;
  descricao: string;
  feito: boolean;
  opcional: boolean;
  link: string;
}

export const primeirosPassosRouter = router({
  estado: procedimentoUnidade.query(async ({ ctx }) => {
    const u = ctx.unidadeId;
    const contar = async (consulta: Promise<Array<{ total: number }>>) => Number((await consulta)[0]?.total ?? 0);
    const [numeros, recebidas, templates, equipe, contatos, campanhas, instagram, segredo, agente, evo] = await Promise.all([
      contar(ctx.db.select({ total: count() }).from(numerosWhatsapp).where(and(eq(numerosWhatsapp.unidadeId, u), eq(numerosWhatsapp.ativo, true)))),
      contar(ctx.db.select({ total: count() }).from(respostasClientes).where(doNumeroDaUnidade(respostasClientes.numeroId, u))),
      contar(
        ctx.db
          .select({ total: count() })
          .from(templatesWhatsapp)
          .where(and(eq(templatesWhatsapp.unidadeId, u), eq(templatesWhatsapp.ativo, true), eq(templatesWhatsapp.status, "APPROVED"))),
      ),
      contar(ctx.db.select({ total: count() }).from(usuarios).where(and(eq(usuarios.unidadeId, u), eq(usuarios.ativo, true)))),
      contar(ctx.db.select({ total: count() }).from(contatosUnidade).where(and(eq(contatosUnidade.unidadeId, u), eq(contatosUnidade.origem, "importacao")))),
      contar(ctx.db.select({ total: count() }).from(campanhasDisparo).where(and(eq(campanhasDisparo.unidadeId, u), ne(campanhasDisparo.status, "agendada")))),
      contar(ctx.db.select({ total: count() }).from(contasInstagram).where(eq(contasInstagram.unidadeId, u))),
      segredoDoAppDaUnidade(ctx.db, u),
      configuracaoDoAgente(ctx.db, u),
      configEvo(ctx.db, u),
    ]);
    const botPronto = agente.modo === "n8n" ? Boolean(agente.webhookN8nUrl) : Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

    const passos: Passo[] = [
      {
        chave: "whatsapp",
        titulo: "Conectar o WhatsApp",
        descricao: "Cadastre a conta (WABA) e o token, e ative o número da unidade.",
        feito: numeros > 0,
        opcional: false,
        link: "#/configuracoes",
      },
      {
        chave: "webhook",
        titulo: "Receber as mensagens",
        descricao: segredo
          ? "Falta a primeira mensagem chegar: mande um 'oi' para o número da unidade depois de um disparo."
          : "Preencha a chave secreta do app da Meta e cadastre o webhook no app.",
        feito: Boolean(segredo) && recebidas > 0,
        opcional: false,
        link: "#/configuracoes",
      },
      {
        chave: "template",
        titulo: "Ter um template aprovado",
        descricao: "Campanhas só saem com template aprovado pela Meta.",
        feito: templates > 0,
        opcional: false,
        link: "#/templates",
      },
      {
        chave: "bot",
        titulo: "Ligar o atendimento automático",
        descricao: "Escolha o agente (IA interna ou fluxo do n8n) em Configurações.",
        feito: botPronto,
        opcional: false,
        link: "#/configuracoes",
      },
      {
        chave: "contatos",
        titulo: "Importar a base de alunos e leads",
        descricao: "Suba a planilha em Contatos para montar segmentos e campanhas.",
        feito: contatos > 0,
        opcional: false,
        link: "#/contatos",
      },
      {
        chave: "campanha",
        titulo: "Disparar a primeira campanha",
        descricao: "Escolha o template, os destinatários e dispare (ou agende).",
        feito: campanhas > 0,
        opcional: false,
        link: "#/nova-campanha",
      },
      {
        chave: "equipe",
        titulo: "Convidar a equipe",
        descricao: "Cada pessoa com o próprio login, para as respostas saírem com o nome dela.",
        feito: equipe > 1,
        opcional: true,
        link: "#/usuarios",
      },
      {
        chave: "evo",
        titulo: "Conectar o EVO",
        descricao: "O bot passa a saber quem é aluno e cadastra os leads.",
        feito: Boolean(evo),
        opcional: true,
        link: "#/configuracoes",
      },
      {
        chave: "instagram",
        titulo: "Conectar o Instagram",
        descricao: "Insights da conta e as DMs dentro de Conversas.",
        feito: instagram > 0,
        opcional: true,
        link: "#/instagram",
      },
    ];
    const obrigatorios = passos.filter((p) => !p.opcional);
    return { passos, prontos: obrigatorios.filter((p) => p.feito).length, total: obrigatorios.length, concluido: obrigatorios.every((p) => p.feito) };
  }),
});
