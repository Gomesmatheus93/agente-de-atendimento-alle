export const TOPICO_OUTROS = "Outros assuntos";

interface Topico {
  nome: string;
  // Trechos já sem acento e em minúsculas; basta um deles aparecer na mensagem.
  palavrasChave: string[];
}

// A ordem importa: o primeiro tópico que combinar vence, então os mais específicos vêm antes.
const TOPICOS: Topico[] = [
  {
    nome: "Cancelamento e trancamento",
    palavrasChave: ["cancel", "trancar", "trancamento", "desist", "encerrar plano", "sair da academia"],
  },
  {
    nome: "Pagamento e boleto",
    palavrasChave: ["boleto", "pagamento", "pagar", "cobranc", "fatura", "pix", "cartao", "segunda via", "vencimento"],
  },
  {
    nome: "Renovação de plano",
    palavrasChave: ["renov"],
  },
  {
    nome: "Aula experimental e matrícula",
    palavrasChave: ["experimental", "matricul", "inscri", "quero comecar", "quero treinar", "visita"],
  },
  {
    nome: "Preços e planos",
    palavrasChave: ["preco", "valor", "quanto custa", "quanto e", "mensalidade", "plano", "promoc", "desconto", "parcel"],
  },
  {
    nome: "Horários de funcionamento",
    palavrasChave: ["horario", "que horas", "abre", "fecha", "funciona", "feriado", "domingo", "sabado"],
  },
  {
    nome: "Aulas e modalidades",
    palavrasChave: ["aula", "modalidade", "musculacao", "spinning", "pilates", "natacao", "funcional", "turma", "professor", "personal"],
  },
  {
    nome: "Localização e unidades",
    palavrasChave: ["onde fica", "endereco", "unidade", "localizacao", "estacionamento", "como chegar"],
  },
];

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Classifica a mensagem de um cliente em um tópico de dúvida.
 * Devolve `null` quando a mensagem não parece uma dúvida (ex.: "ok", "obrigado"), ou seja,
 * quando não tem interrogação nem palavra-chave de nenhum tópico.
 */
export function classificarDuvida(texto: string): string | null {
  const normalizado = normalizar(texto);
  const topico = TOPICOS.find((item) => item.palavrasChave.some((palavra) => normalizado.includes(palavra)));

  if (topico) return topico.nome;
  return normalizado.includes("?") ? TOPICO_OUTROS : null;
}

export const TOPICOS_DE_DUVIDA: readonly string[] = [...TOPICOS.map((topico) => topico.nome), TOPICO_OUTROS];
