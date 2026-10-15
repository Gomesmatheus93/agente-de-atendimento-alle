import {
  campanhasDisparo,
  disparoDestinatarios,
  funilClientes,
  sugestoesIa,
  templatesWhatsapp,
  usoIa,
} from "@atendimento-academias/db";
import { custoIaUsd } from "@atendimento-academias/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { como, criarUnidade, db, zerarBanco, type UnidadeDeTeste } from "./apoio.js";

// Financeiro: cada fonte de gasto convertida em reais, no dia certo, e o retorno. Valores escolhidos para
// dar contas redondas (e conferíveis à mão).

let u: UnidadeDeTeste;
const PERIODO = { periodo: "personalizado" as const, inicio: "2026-03-01", fim: "2026-03-31" };
const em = (dia: string, hora = "15:00") => new Date(`${dia}T${hora}:00-03:00`);

beforeAll(async () => {
  await zerarBanco();
  u = await criarUnidade();
  const [template] = await db.insert(templatesWhatsapp).values({ unidadeId: u.id, nome: "promo", conteudo: "Oi", categoria: "marketing" } as never).returning();
  // Campanha em março: 2 enviadas a R$ 0,35 = R$ 0,70 (a falha não conta).
  const [campanha] = await db
    .insert(campanhasDisparo)
    .values({ unidadeId: u.id, nome: "Promo de março", templateId: template!.id, numeroId: u.numeroId, status: "concluida", custoUnitario: "0.3500", disparoEm: em("2026-03-10") } as never)
    .returning();
  await db.insert(disparoDestinatarios).values([
    { campanhaId: campanha!.id, telefone: "5511900000001", parametros: {}, statusEnvio: "enviado", enviadoEm: em("2026-03-10") },
    { campanhaId: campanha!.id, telefone: "5511900000002", parametros: {}, statusEnvio: "enviado", enviadoEm: em("2026-03-10") },
    { campanhaId: campanha!.id, telefone: "5511900000003", parametros: {}, statusEnvio: "falhou" },
  ]);
  // Campanha de fevereiro: fica no período anterior.
  const [antiga] = await db
    .insert(campanhasDisparo)
    .values({ unidadeId: u.id, nome: "Promo de fevereiro", templateId: template!.id, numeroId: u.numeroId, status: "concluida", custoUnitario: "0.3500", disparoEm: em("2026-02-10") } as never)
    .returning();
  await db.insert(disparoDestinatarios).values({ campanhaId: antiga!.id, telefone: "5511900000004", parametros: {}, statusEnvio: "enviado", enviadoEm: em("2026-02-10") });
  // IA: 1M tokens de entrada no Opus 5.5 = US$ 4; 1M+1M no Haiku 5.5 = US$ 0,60. Cotação padrão 5,5.
  await db.insert(sugestoesIa).values({ telefone: "5511900000001", numeroId: u.numeroId, texto: "x", modelo: "claude-opus-5-5", tokensEntrada: 1_000_000, tokensSaida: 0, createdAt: em("2026-03-12") });
  await db.insert(usoIa).values({ numeroId: u.numeroId, origem: "analise", modelo: "claude-haiku-5-5", tokensEntrada: 1_000_000, tokensSaida: 1_000_000, criadoEm: em("2026-03-12") });
  // Duas matrículas em março.
  await db.insert(funilClientes).values([
    { telefone: "5511900000001", numeroId: u.numeroId, etapa: "fechou", etapaDesde: em("2026-03-15") },
    { telefone: "5511900000002", numeroId: u.numeroId, etapa: "fechou", etapaDesde: em("2026-03-20") },
  ]);
});

describe("financeiro", () => {
  it("custo da IA pelo modelo, achando o mais específico", () => {
    expect(custoIaUsd("claude-opus-5-5", 1_000_000, 0)).toBe(4);
    expect(custoIaUsd("claude-opus-5", 1_000_000, 0)).toBe(5);
    expect(custoIaUsd("claude-haiku-5-5", 1_000_000, 1_000_000)).toBeCloseTo(0.6);
    expect(custoIaUsd("modelo-desconhecido", 1_000_000, 0)).toBe(4);
  });

  it("soma cada fonte no período e separa o anterior", async () => {
    const api = como(u.admin).api;
    // Aluguel do servidor: recorrente desde 31/01 (cai em 28/02 e 31/03) + um gasto avulso em março.
    await api.financeiro.salvarLancamento({ descricao: "Servidor", valor: 100, data: "2026-01-31", recorrente: true });
    await api.financeiro.salvarLancamento({ descricao: "Ajuste no fluxo", valor: 50, data: "2026-03-05", recorrente: false });
    await api.financeiro.salvarConfig({ ticketMedio: 200, cotacaoDolar: 5.5, precos: { marketing: 0.35, utilidade: 0.05, autenticacao: 0.05, servico: 0 } });

    const r = await api.financeiro.resumo(PERIODO);
    expect(r.gasto.atual).toEqual({ whatsapp: 0.7, ia: 25.3, manual: 150, total: 176 }); // 0,70 + (22 + 3,30) + (100 + 50)
    // Anterior = os 31 dias antes de março (29/01 a 28/02): campanha de fevereiro e o servidor em 31/01 e 28/02.
    expect(r.gasto.anterior).toEqual({ whatsapp: 0.35, ia: 0, manual: 200, total: 200.35 });
    expect(r.retorno).toMatchObject({ matriculas: 2, custoPorMatricula: 88, receitaEstimada: 400, retornoPorReal: 2.3 });
    expect(r.ia).toMatchObject({ sugestoes: { reais: 22 }, analise: { reais: 3.3 } });
    expect(r.campanhas.map((c) => [c.nome, c.enviadas, c.custo])).toEqual([["Promo de março", 2, 0.7]]);
    const dia12 = r.serie.find((p) => p.dia === "2026-03-12")!;
    expect(dia12.ia).toBe(25.3);
    expect(r.serie.find((p) => p.dia === "2026-03-31")!.manual).toBe(100);
    expect(r.detalhamento[0]).toMatchObject({ rotulo: "Servidor", valor: 100 });
  });

  it("o preço por categoria da unidade vale para as campanhas novas", async () => {
    const api = como(u.admin).api;
    await api.financeiro.salvarConfig({ ticketMedio: null, cotacaoDolar: 5.5, precos: { marketing: 0.5, utilidade: 0.05, autenticacao: 0.05, servico: 0 } });
    const [template] = await db.select().from(templatesWhatsapp).where(eq(templatesWhatsapp.unidadeId, u.id));
    const { id } = await api.campanhas.criar({ nome: "Nova", templateId: template!.id, numeroId: u.numeroId, destinatarios: [{ telefone: "11911112222", parametros: {} }] });
    const [campanha] = await db.select().from(campanhasDisparo).where(eq(campanhasDisparo.id, id));
    expect(campanha!.custoUnitario).toBe("0.5000");
  });

  it("só o admin vê, e só a própria unidade", async () => {
    await expect(como(u.membro).api.financeiro.resumo(PERIODO)).rejects.toThrow(/administrador/);
    const outra = await criarUnidade();
    const deOutra = await como(outra.admin).api.financeiro.resumo(PERIODO);
    expect(deOutra.gasto.atual.total).toBe(0);
    const [lanc] = await como(u.admin).api.financeiro.lancamentos();
    await como(outra.admin).api.financeiro.excluirLancamento({ id: lanc!.id });
    expect((await como(u.admin).api.financeiro.lancamentos()).length).toBe(2);
  });
});
