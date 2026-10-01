import type {
  WhatsAppAudioMessage,
  WhatsAppImageMessage,
  WhatsAppProvider,
  WhatsAppSendResult,
  WhatsAppTemplateMessage,
  WhatsAppTextMessage,
} from "./WhatsAppProvider.js";

// Telefones terminados nesse sufixo simulam falha, para exercitar o status "falhou" sem provedor real.
const SUFIXO_FALHA_SIMULADA = "0000";

// Simulador de desenvolvimento: usado quando WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN não estão
// configurados. O envio real vive em WhatsAppProviderCloudApi (WhatsApp Cloud API da Meta).
export class WhatsAppProviderStub implements WhatsAppProvider {
  async enviarTemplate(mensagem: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
    console.warn(
      `[WhatsAppProviderStub] simulando envio. telefone=${mensagem.telefone} template=${mensagem.template.nome} parametros=${JSON.stringify(mensagem.parametros)}`,
    );

    if (mensagem.telefone.endsWith(SUFIXO_FALHA_SIMULADA)) {
      return { sucesso: false, erro: "Falha simulada pelo stub (telefone terminado em 0000)" };
    }

    return { sucesso: true, mensagemId: `stub-${Date.now()}-${mensagem.telefone}` };
  }

  async enviarTexto(mensagem: WhatsAppTextMessage): Promise<WhatsAppSendResult> {
    console.warn(`[WhatsAppProviderStub] simulando texto livre. telefone=${mensagem.telefone} texto=${JSON.stringify(mensagem.texto)}`);

    if (mensagem.telefone.endsWith(SUFIXO_FALHA_SIMULADA)) {
      return { sucesso: false, erro: "Falha simulada pelo stub (telefone terminado em 0000)" };
    }

    return { sucesso: true, mensagemId: `stub-texto-${Date.now()}-${mensagem.telefone}` };
  }

  async enviarAudio(mensagem: WhatsAppAudioMessage): Promise<WhatsAppSendResult> {
    console.warn(
      `[WhatsAppProviderStub] simulando áudio. telefone=${mensagem.telefone} mimeType=${mensagem.mimeType} bytes=${mensagem.audio.byteLength}`,
    );

    if (mensagem.telefone.endsWith(SUFIXO_FALHA_SIMULADA)) {
      return { sucesso: false, erro: "Falha simulada pelo stub (telefone terminado em 0000)" };
    }

    return { sucesso: true, mensagemId: `stub-audio-${Date.now()}-${mensagem.telefone}` };
  }

  async enviarImagem(mensagem: WhatsAppImageMessage): Promise<WhatsAppSendResult> {
    console.warn(`[WhatsAppProviderStub] simulando imagem. telefone=${mensagem.telefone} imagem=${mensagem.midiaUrl} legenda=${JSON.stringify(mensagem.legenda ?? "")}`);

    if (mensagem.telefone.endsWith(SUFIXO_FALHA_SIMULADA)) {
      return { sucesso: false, erro: "Falha simulada pelo stub (telefone terminado em 0000)" };
    }

    return { sucesso: true, mensagemId: `stub-imagem-${Date.now()}-${mensagem.telefone}` };
  }
}
