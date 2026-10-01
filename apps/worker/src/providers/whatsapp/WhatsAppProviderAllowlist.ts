import { normalizarTelefone } from "@atendimento-academias/shared";
import type {
  WhatsAppAudioMessage,
  WhatsAppImageMessage,
  WhatsAppProvider,
  WhatsAppSendResult,
  WhatsAppTemplateMessage,
  WhatsAppTextMessage,
} from "./WhatsAppProvider.js";

// Trava de bancada: envolve o provider real e só deixa passar os telefones da lista.
// Existe porque o número remetente é de produção e compartilhado — um clique errado na tela de
// Conversas, ou uma lista colada sem querer em Nova campanha, alcançaria cliente de verdade.
export class WhatsAppProviderAllowlist implements WhatsAppProvider {
  private readonly permitidos: Set<string>;

  constructor(
    private readonly provider: WhatsAppProvider,
    permitidos: string[],
  ) {
    this.permitidos = new Set(permitidos);
  }

  // A lista vem do .env com máscara, com ou sem 55; normaliza igual ao resto do sistema.
  static parseLista(valor: string | undefined): string[] {
    if (!valor) return [];
    return valor
      .split(",")
      .map((item) => normalizarTelefone(item.trim()))
      .filter((item): item is string => item !== null);
  }

  private bloqueio(telefone: string): WhatsAppSendResult | null {
    if (this.permitidos.has(telefone)) return null;

    console.warn(`[whatsapp:trava] envio para ${telefone} bloqueado: fora de WHATSAPP_NUMEROS_PERMITIDOS`);
    return {
      sucesso: false,
      erro: `Bloqueado pela trava de teste: ${telefone} não está em WHATSAPP_NUMEROS_PERMITIDOS`,
    };
  }

  async enviarTemplate(mensagem: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
    return this.bloqueio(mensagem.telefone) ?? this.provider.enviarTemplate(mensagem);
  }

  async enviarTexto(mensagem: WhatsAppTextMessage): Promise<WhatsAppSendResult> {
    return this.bloqueio(mensagem.telefone) ?? this.provider.enviarTexto(mensagem);
  }

  async enviarAudio(mensagem: WhatsAppAudioMessage): Promise<WhatsAppSendResult> {
    return this.bloqueio(mensagem.telefone) ?? this.provider.enviarAudio(mensagem);
  }

  async enviarImagem(mensagem: WhatsAppImageMessage): Promise<WhatsAppSendResult> {
    return this.bloqueio(mensagem.telefone) ?? this.provider.enviarImagem(mensagem);
  }
}
