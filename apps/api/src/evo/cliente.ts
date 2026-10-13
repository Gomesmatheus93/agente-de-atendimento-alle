import type { Db } from "@atendimento-academias/db";
import { lerValor, salvarValor } from "../config/plataforma.js";

// Integração com o EVO (W12), o sistema de gestão da academia: saber se quem fala no WhatsApp já é aluno
// (ou lead) e cadastrar como lead quem ainda não está lá. Cada unidade usa a própria conta do EVO: o DNS
// da academia e a chave da API (Configurações → Integração no EVO) entram como usuário e senha (Basic).

const BASE = "https://evo-integracao-api.w12app.com.br";
const TEMPO_LIMITE_MS = 15_000;
const VALIDADE_CACHE_MS = 10 * 60_000;

export const CHAVE_EVO_DNS = "evo.dns";
export const CHAVE_EVO_CHAVE = "evo.chave";
export const CHAVE_EVO_CHAVE_FINAL = "evo.chave_final";
export const CHAVE_EVO_ID_BRANCH = "evo.id_branch";

export interface ConfigEvo {
  dns: string;
  chave: string;
  // Só para chave "multilocal" (rede com várias filiais na mesma conta): filtra/cadastra nessa filial.
  idBranch: number | null;
}

export class ErroEvo extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function configEvo(db: Db, unidadeId: number): Promise<ConfigEvo | null> {
  const [dns, chave, idBranch] = await Promise.all([
    lerValor(db, unidadeId, CHAVE_EVO_DNS),
    lerValor(db, unidadeId, CHAVE_EVO_CHAVE),
    lerValor(db, unidadeId, CHAVE_EVO_ID_BRANCH),
  ]);
  if (!dns || !chave) return null;
  return { dns, chave, idBranch: idBranch ? Number(idBranch) : null };
}

export async function salvarConfigEvo(db: Db, unidadeId: number, dados: { dns: string; chave?: string; idBranch: number | null }): Promise<void> {
  await salvarValor(db, unidadeId, CHAVE_EVO_DNS, dados.dns);
  if (dados.chave) {
    await salvarValor(db, unidadeId, CHAVE_EVO_CHAVE, dados.chave, true);
    await salvarValor(db, unidadeId, CHAVE_EVO_CHAVE_FINAL, dados.chave.slice(-4));
  }
  await salvarValor(db, unidadeId, CHAVE_EVO_ID_BRANCH, dados.idBranch === null ? "" : String(dados.idBranch));
  limparCacheDaUnidade(unidadeId);
}

async function chamar<T>(
  config: ConfigEvo,
  metodo: "GET" | "POST",
  caminho: string,
  query: Record<string, string | number | undefined> = {},
  corpo?: unknown,
): Promise<T> {
  const url = new URL(caminho, BASE);
  for (const [chave, valor] of Object.entries(query)) if (valor !== undefined && valor !== "") url.searchParams.set(chave, String(valor));
  if (config.idBranch !== null && !url.searchParams.has("idBranch")) url.searchParams.set("idBranch", String(config.idBranch));

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: metodo,
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.dns}:${config.chave}`).toString("base64")}`,
        Accept: "application/json",
        ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
  } catch (erro) {
    throw new ErroEvo(`Não foi possível falar com o EVO: ${erro instanceof Error ? erro.message : String(erro)}`, 0);
  }

  const texto = await resposta.text();
  let dados: unknown = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    // resposta sem JSON (ex.: página de erro)
  }
  if (!resposta.ok) {
    if (resposta.status === 401 || resposta.status === 403) throw new ErroEvo("O EVO recusou o acesso: confira o DNS e a chave da API da unidade.", resposta.status);
    const mensagens = (dados as { mensagens?: unknown[] } | null)?.mensagens;
    const detalhe = Array.isArray(mensagens) && mensagens.length > 0 ? mensagens.map(String).join("; ") : `HTTP ${resposta.status}`;
    throw new ErroEvo(`O EVO recusou: ${detalhe}`, resposta.status);
  }
  return dados as T;
}

// O EVO guarda o telefone sem o 55 ("Ex.: 1112341234"). O WhatsApp às vezes manda celular sem o nono
// dígito: procura nas duas formas.
export function telefonesParaEvo(telefone: string): string[] {
  let digitos = telefone.replace(/\D/g, "");
  if (digitos.startsWith("55") && digitos.length >= 12) digitos = digitos.slice(2);
  const variantes = new Set([digitos]);
  if (digitos.length === 11 && digitos[2] === "9") variantes.add(digitos.slice(0, 2) + digitos.slice(3));
  if (digitos.length === 10) variantes.add(`${digitos.slice(0, 2)}9${digitos.slice(2)}`);
  return [...variantes];
}

interface MembroEvo {
  idMember: number;
  firstName?: string;
  lastName?: string;
  registerName?: string;
  status?: string;
  membershipStatus?: string;
  branchName?: string;
  accessBlocked?: boolean;
  registerDate?: string;
  lastAccessDate?: string;
  memberships?: Array<{ name?: string; membershipName?: string; membershipStatus?: string; endDate?: string; membershipEnd?: string }>;
}

interface ProspectEvo {
  idProspect: number;
  firstName?: string;
  lastName?: string;
  registerDate?: string;
  currentStep?: string;
  idMember?: number | null;
  conversionDate?: string | null;
}

export type SituacaoEvo =
  | {
      situacao: "aluno";
      aluno: { id: number; nome: string; ativo: boolean; status: string | null; unidade: string | null; bloqueado: boolean; planos: Array<{ nome: string; status: string | null; vencimento: string | null }>; ultimoAcesso: string | null };
    }
  | { situacao: "lead"; lead: { id: number; nome: string; cadastradoEm: string | null; etapa: string | null } }
  | { situacao: "nao_cadastrado" };

const lista = <T>(dados: unknown): T[] => (Array.isArray(dados) ? (dados as T[]) : dados ? [dados as T] : []);
const nomeDe = (pessoa: { firstName?: string; lastName?: string; registerName?: string }) =>
  [pessoa.firstName ?? pessoa.registerName, pessoa.lastName].filter(Boolean).join(" ").trim() || "Sem nome";

async function buscarMembro(config: ConfigEvo, filtros: Array<Record<string, string>>): Promise<MembroEvo | null> {
  for (const filtro of filtros) {
    const encontrados = lista<MembroEvo>(await chamar(config, "GET", "/api/v1/members/basic", { ...filtro, take: 5 }));
    // Aluno ativo primeiro, se o mesmo telefone tiver mais de um cadastro.
    const membro = encontrados.find((item) => /ativ|active/i.test(item.membershipStatus ?? item.status ?? "")) ?? encontrados[0];
    if (membro?.idMember) return membro;
  }
  return null;
}

async function buscarProspect(config: ConfigEvo, filtros: Array<Record<string, string>>): Promise<ProspectEvo | null> {
  for (const filtro of filtros) {
    const encontrados = lista<ProspectEvo>(await chamar(config, "GET", "/api/v1/prospects", { ...filtro, take: 5 }));
    const prospect = encontrados.find((item) => !item.idMember) ?? encontrados[0];
    if (prospect?.idProspect) return prospect;
  }
  return null;
}

export interface IdentificacaoCliente {
  telefone: string;
  cpf?: string | null;
  email?: string | null;
}

function filtrosDe(cliente: IdentificacaoCliente): Array<Record<string, string>> {
  const filtros: Array<Record<string, string>> = [];
  const cpf = cliente.cpf?.replace(/\D/g, "");
  if (cpf && cpf.length === 11) filtros.push({ document: cpf });
  if (cliente.email?.includes("@")) filtros.push({ email: cliente.email.trim().toLowerCase() });
  for (const telefone of telefonesParaEvo(cliente.telefone)) filtros.push({ phone: telefone });
  return filtros;
}

const cache = new Map<string, { valor: SituacaoEvo; em: number }>();
const chaveDoCache = (unidadeId: number, cliente: IdentificacaoCliente) =>
  `${unidadeId}:${cliente.telefone}:${cliente.cpf ?? ""}:${cliente.email ?? ""}`;

function limparCacheDaUnidade(unidadeId: number, telefone?: string): void {
  for (const chave of cache.keys()) if (chave.startsWith(`${unidadeId}:${telefone ?? ""}`)) cache.delete(chave);
}

// Aluno (member) tem prioridade sobre lead (prospect): quem já virou aluno também continua como prospect
// convertido no EVO.
export async function situacaoNoEvo(config: ConfigEvo, unidadeId: number, cliente: IdentificacaoCliente, usarCache = true): Promise<SituacaoEvo> {
  const chave = chaveDoCache(unidadeId, cliente);
  const guardado = cache.get(chave);
  if (usarCache && guardado && Date.now() - guardado.em < VALIDADE_CACHE_MS) return guardado.valor;

  const filtros = filtrosDe(cliente);
  let valor: SituacaoEvo;
  const membro = await buscarMembro(config, filtros);
  if (membro) {
    const status = membro.membershipStatus ?? membro.status ?? null;
    valor = {
      situacao: "aluno",
      aluno: {
        id: membro.idMember,
        nome: nomeDe(membro),
        ativo: /ativ|active/i.test(status ?? "") && !/inativ|inactive/i.test(status ?? ""),
        status,
        unidade: membro.branchName ?? null,
        bloqueado: Boolean(membro.accessBlocked),
        planos: (membro.memberships ?? []).slice(0, 3).map((plano) => ({
          nome: plano.name ?? plano.membershipName ?? "Plano",
          status: plano.membershipStatus ?? null,
          vencimento: plano.endDate ?? plano.membershipEnd ?? null,
        })),
        ultimoAcesso: membro.lastAccessDate ?? null,
      },
    };
  } else {
    const prospect = await buscarProspect(config, filtros);
    valor = prospect
      ? { situacao: "lead", lead: { id: prospect.idProspect, nome: nomeDe(prospect), cadastradoEm: prospect.registerDate ?? null, etapa: prospect.currentStep ?? null } }
      : { situacao: "nao_cadastrado" };
  }
  cache.set(chave, { valor, em: Date.now() });
  return valor;
}

export interface DadosDeCadastro extends IdentificacaoCliente {
  nome: string;
  nascimento?: string | null;
  genero?: string | null;
  observacao?: string | null;
}

// "AAAA-MM-DD" a partir de "DD/MM/AAAA" ou "AAAA-MM-DD"; outro formato fica de fora (o EVO recusaria).
function dataParaEvo(data: string | null | undefined): string | undefined {
  if (!data) return undefined;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data.trim());
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(data.trim()) ? data.trim() : undefined;
}

// Cadastra como lead (prospect) quem ainda não está no EVO. Se já for aluno ou lead, não duplica: devolve
// o cadastro existente. Virar aluno (matrícula com plano e pagamento) continua sendo feito pela equipe no EVO.
export async function cadastrarLeadNoEvo(
  config: ConfigEvo,
  unidadeId: number,
  dados: DadosDeCadastro,
): Promise<{ criado: boolean; situacao: SituacaoEvo }> {
  const existente = await situacaoNoEvo(config, unidadeId, dados, false);
  if (existente.situacao !== "nao_cadastrado") return { criado: false, situacao: existente };

  const [primeiro, ...resto] = dados.nome.trim().split(/\s+/);
  const celular = telefonesParaEvo(dados.telefone)[0]!;
  const cpf = dados.cpf?.replace(/\D/g, "");
  const resposta = await chamar<{ idProspect: number }>(config, "POST", "/api/v1/prospects", {}, {
    name: primeiro,
    lastName: resto.join(" ") || undefined,
    ddi: "55",
    cellphone: celular,
    email: dados.email?.trim().toLowerCase() || undefined,
    cpf: cpf && cpf.length === 11 ? cpf : undefined,
    birthday: dataParaEvo(dados.nascimento),
    gender: dados.genero || undefined,
    marketingType: "WhatsApp",
    notes: (dados.observacao ? `${dados.observacao}\n` : "") + "Cadastrado pelo atendimento do WhatsApp (Allp Chat).",
    ...(config.idBranch !== null ? { idBranch: config.idBranch } : {}),
  });
  limparCacheDaUnidade(unidadeId, dados.telefone);
  const situacao: SituacaoEvo = { situacao: "lead", lead: { id: resposta.idProspect, nome: dados.nome.trim(), cadastradoEm: new Date().toISOString(), etapa: null } };
  return { criado: true, situacao };
}

// Usado pelo botão "Testar conexão": uma consulta mínima que só passa com DNS e chave certos.
export async function testarEvo(config: ConfigEvo): Promise<void> {
  await chamar(config, "GET", "/api/v1/prospects", { take: 1 });
}
