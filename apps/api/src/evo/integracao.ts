import type { Db } from "@atendimento-academias/db";
import { z } from "zod";
import { cadastrarLeadNoEvo, configEvo, ErroEvo, situacaoNoEvo, type DadosDeCadastro, type SituacaoEvo } from "./cliente.js";

// O que o bot (n8n) e o painel recebem sobre o cliente no EVO. "nao_configurado" quando a unidade ainda
// não ligou o EVO; "erro" quando o EVO não respondeu — o atendimento segue mesmo assim.
export type SituacaoParaIa = SituacaoEvo | { situacao: "nao_configurado" } | { situacao: "erro"; mensagem: string };

const ESPERA_MAXIMA_MS = 6_000;

// Junto da conversa que o n8n busca a cada mensagem: não pode atrasar a resposta do bot, então desiste
// depois de alguns segundos (a consulta seguinte, de outra mensagem, costuma já vir do cache).
export async function situacaoParaIa(db: Db, unidadeId: number, telefone: string): Promise<SituacaoParaIa> {
  const config = await configEvo(db, unidadeId);
  if (!config) return { situacao: "nao_configurado" };
  try {
    return await Promise.race([
      situacaoNoEvo(config, unidadeId, { telefone }),
      new Promise<SituacaoParaIa>((resolver) =>
        setTimeout(() => resolver({ situacao: "erro", mensagem: "O EVO demorou para responder." }), ESPERA_MAXIMA_MS).unref(),
      ),
    ]);
  } catch (erro) {
    return { situacao: "erro", mensagem: erro instanceof Error ? erro.message : String(erro) };
  }
}

export const dadosDeCadastroSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome").max(120),
  cpf: z.string().trim().max(20).nullish(),
  email: z.string().trim().max(150).nullish(),
  nascimento: z.string().trim().max(20).nullish(),
  genero: z.string().trim().max(1).nullish(),
  observacao: z.string().trim().max(500).nullish(),
});

export async function cadastrarNoEvo(
  db: Db,
  unidadeId: number,
  telefone: string,
  dados: z.infer<typeof dadosDeCadastroSchema>,
): Promise<{ criado: boolean; situacao: SituacaoEvo }> {
  const config = await configEvo(db, unidadeId);
  if (!config) throw new ErroEvo("O EVO não está configurado nesta unidade (Configurações → EVO).", 412);
  const cadastro: DadosDeCadastro = { telefone, ...dados };
  return cadastrarLeadNoEvo(config, unidadeId, cadastro);
}

const MARCA = "[CADASTRAR_EVO]";

// O bot pede o cadastro escrevendo, na resposta, [CADASTRAR_EVO]{"nome":"…","cpf":"…",…} (do mesmo jeito
// que pede a imagem dos planos). A plataforma tira a marcação do texto antes de mandar ao cliente e faz o
// cadastro. Devolve o texto limpo e os dados (ou null, se não houver marcação válida).
export function extrairPedidoDeCadastro(texto: string): { texto: string; dados: z.infer<typeof dadosDeCadastroSchema> | null } {
  const inicio = texto.indexOf(MARCA);
  if (inicio === -1) return { texto, dados: null };
  const abre = texto.indexOf("{", inicio + MARCA.length);
  let fim = -1;
  if (abre !== -1) {
    let profundidade = 0;
    for (let indice = abre; indice < texto.length; indice += 1) {
      if (texto[indice] === "{") profundidade += 1;
      else if (texto[indice] === "}" && --profundidade === 0) {
        fim = indice;
        break;
      }
    }
  }
  const trecho = fim === -1 ? texto.slice(inicio) : texto.slice(inicio, fim + 1);
  const limpo = (texto.slice(0, inicio) + texto.slice(inicio + trecho.length)).replace(/\n{3,}/g, "\n\n").trim();
  if (fim === -1) return { texto: limpo, dados: null };
  try {
    const dados = dadosDeCadastroSchema.safeParse(JSON.parse(texto.slice(abre, fim + 1)));
    return { texto: limpo, dados: dados.success ? dados.data : null };
  } catch {
    return { texto: limpo, dados: null };
  }
}
