export interface WhatsAppTemplateMessage {
  telefone: string;
  template: {
    nome: string;
    // Idioma com que o template foi aprovado na Meta; nome + idioma é a chave lá.
    idioma?: string;
    // Templates aprovados com cabeçalho de imagem exigem a imagem em todo envio (URL pública https).
    cabecalhoImagemUrl?: string | null;
  };
  // Valores dos placeholders do template, indexados pelo nome ({{nome}} -> parametros.nome).
  parametros: Record<string, string>;
}

// Texto livre: o WhatsApp só o aceita até 24h depois da última mensagem do cliente (quem chama já checou isso).
export interface WhatsAppTextMessage {
  telefone: string;
  texto: string;
}

// Nota de voz gravada no painel. Mesma janela de 24h do texto livre; o conteúdo vai como bytes porque a
// Cloud API exige subir a mídia antes (POST /media) para então enviar pelo id devolvido.
export interface WhatsAppAudioMessage {
  telefone: string;
  audio: Buffer;
  mimeType: string;
}

// Imagem do agente (ex.: tabela de planos), com o texto da resposta como legenda. midiaUrl é o caminho
// local ("/uploads/..."), que o provider sobe para a Meta; a legenda vai até 1024 caracteres.
export interface WhatsAppImageMessage {
  telefone: string;
  midiaUrl: string;
  legenda?: string;
}

export interface WhatsAppSendResult {
  sucesso: boolean;
  mensagemId?: string;
  erro?: string;
}

export interface WhatsAppProvider {
  enviarTemplate(mensagem: WhatsAppTemplateMessage): Promise<WhatsAppSendResult>;
  enviarTexto(mensagem: WhatsAppTextMessage): Promise<WhatsAppSendResult>;
  enviarAudio(mensagem: WhatsAppAudioMessage): Promise<WhatsAppSendResult>;
  enviarImagem(mensagem: WhatsAppImageMessage): Promise<WhatsAppSendResult>;
}
