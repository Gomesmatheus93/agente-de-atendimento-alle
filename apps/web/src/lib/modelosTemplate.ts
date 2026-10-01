// Pontos de partida para criar template na tela Templates. Não são os da biblioteca da Meta: lá o texto é
// travado (só botões mudam), e editar o texto faz o template passar por análise do mesmo jeito. Estes já
// seguem as regras que a Meta confere (exemplo por variável, nenhuma variável no começo ou no fim).
export interface ModeloTemplate {
  id: string;
  titulo: string;
  descricao: string;
  categoria: "marketing" | "utilidade";
  nomeSugerido: string;
  cabecalho: { tipo: "nenhum" } | { tipo: "texto"; texto: string } | { tipo: "imagem" };
  corpo: string;
  exemplos: Record<string, string>;
  rodape: string;
}

export const MODELOS_TEMPLATE: ModeloTemplate[] = [
  {
    id: "boas-vindas",
    titulo: "Boas-vindas",
    descricao: "Primeiro contato com quem acabou de se cadastrar.",
    categoria: "marketing",
    nomeSugerido: "boas_vindas_cliente",
    cabecalho: { tipo: "texto", texto: "Seja bem-vindo(a)!" },
    corpo:
      "Olá, {{nome}}! Que bom ter você com a gente. 🎉\n\nA partir de agora você recebe por aqui as novidades e os avisos importantes sobre o seu plano.\n\nQualquer dúvida, é só responder esta mensagem.",
    exemplos: { nome: "Maria" },
    rodape: "Allp Fit",
  },
  {
    id: "promocao",
    titulo: "Promoção com imagem",
    descricao: "Oferta por tempo limitado, com banner no topo.",
    categoria: "marketing",
    nomeSugerido: "promocao_mes",
    cabecalho: { tipo: "imagem" },
    corpo:
      "Oi, {{nome}}! Preparamos uma condição especial para você: *{{desconto}} de desconto* na matrícula do plano Allp Premium.\n\nA oferta vale até {{validade}}. Quer garantir a sua? Responda *QUERO* que a gente te ajuda.",
    exemplos: { nome: "Maria", desconto: "30%", validade: "30/09" },
    rodape: "Responda SAIR para não receber ofertas",
  },
  {
    id: "lembrete-pagamento",
    titulo: "Lembrete de pagamento",
    descricao: "Aviso de vencimento para quem já é cliente.",
    categoria: "utilidade",
    nomeSugerido: "lembrete_vencimento",
    cabecalho: { tipo: "nenhum" },
    corpo:
      "Olá, {{nome}}. Passando para lembrar que a sua mensalidade de *{{valor}}* vence em *{{vencimento}}*.\n\nSe já pagou, pode desconsiderar este aviso. Obrigado!",
    exemplos: { nome: "Maria", valor: "R$ 129,90", vencimento: "10/10" },
    rodape: "",
  },
  {
    id: "documento-pendente",
    titulo: "Documento pendente",
    descricao: "Pede algo que falta para concluir o cadastro.",
    categoria: "utilidade",
    nomeSugerido: "documento_pendente",
    cabecalho: { tipo: "texto", texto: "Falta pouco!" },
    corpo:
      "Olá, {{nome}}! Para concluir o seu cadastro, ainda precisamos do seguinte documento: *{{documento}}*.\n\nVocê pode enviar uma foto ou o PDF respondendo esta mensagem.",
    exemplos: { nome: "Maria", documento: "conta de energia mais recente" },
    rodape: "",
  },
  {
    id: "confirmacao",
    titulo: "Confirmação de cadastro",
    descricao: "Confirma que um cadastro ou pedido foi concluído.",
    categoria: "utilidade",
    nomeSugerido: "cadastro_confirmado",
    cabecalho: { tipo: "nenhum" },
    corpo:
      "Tudo certo, {{nome}}! O seu cadastro no plano *{{plano}}* foi concluído com sucesso.\n\nO seu acesso já está liberado a partir de {{inicio}}. Bons treinos!",
    exemplos: { nome: "Maria", plano: "Allp Start", inicio: "01/10" },
    rodape: "",
  },
  {
    id: "lembrete-agendamento",
    titulo: "Lembrete de horário",
    descricao: "Lembra de uma aula ou visita agendada.",
    categoria: "utilidade",
    nomeSugerido: "lembrete_agendamento",
    cabecalho: { tipo: "nenhum" },
    corpo:
      "Olá, {{nome}}! Lembrete da sua *{{atividade}}* marcada para *{{data}}* às *{{horario}}*.\n\nSe não puder ir, responda esta mensagem para remarcar.",
    exemplos: { nome: "Maria", atividade: "aula experimental", data: "05/10", horario: "18h" },
    rodape: "",
  },
  {
    id: "reengajamento",
    titulo: "Sentimos sua falta",
    descricao: "Retoma contato com quem parou de responder.",
    categoria: "marketing",
    nomeSugerido: "sentimos_sua_falta",
    cabecalho: { tipo: "nenhum" },
    corpo:
      "Oi, {{nome}}! Faz um tempo que não conversamos. 😊\n\nNotamos que você não concluiu o seu atendimento. Podemos continuar de onde paramos? É só responder por aqui.",
    exemplos: { nome: "Maria" },
    rodape: "",
  },
  {
    id: "pesquisa",
    titulo: "Pesquisa de satisfação",
    descricao: "Pergunta rápida sobre a experiência do cliente.",
    categoria: "marketing",
    nomeSugerido: "pesquisa_satisfacao",
    cabecalho: { tipo: "nenhum" },
    corpo:
      "Olá, {{nome}}! Sua opinião é muito importante para nós.\n\nDe 0 a 10, quanto você recomendaria a Allp Fit para um amigo? Responda só com o número.",
    exemplos: { nome: "Maria" },
    rodape: "",
  },
];
