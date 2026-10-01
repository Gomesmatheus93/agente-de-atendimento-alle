import { lerMidiaLocal } from "../../media/armazenamento.js";
import type {
  WhatsAppAudioMessage,
  WhatsAppImageMessage,
  WhatsAppProvider,
  WhatsAppSendResult,
  WhatsAppTemplateMessage,
  WhatsAppTextMessage,
} from "./WhatsAppProvider.js";

const TIMEOUT_MS = 30_000;

// Imagem de cabeçalho enviada pela tela Templates fica no disco ("/uploads/..."); a Meta não alcança esse
// caminho, então ela sobe uma vez por número e o media id é reaproveitado. A Meta guarda a mídia por 30
// dias; renovar antes disso evita mandar um id vencido.
const VALIDADE_MEDIA_ID_MS = 25 * 86_400_000;
const mediaIdPorImagem = new Map<string, { id: string; em: number }>();

export interface CloudApiConfig {
  // ID do número remetente (WhatsApp Manager > Configuração da API > "ID do número de telefone").
  phoneNumberId: string;
  // Token permanente do usuário do sistema, ou o token temporário de teste.
  accessToken: string;
  // Versão da Graph API, ex: "v25.0".
  apiVersion: string;
  // Idioma com que os templates foram aprovados na Meta, ex: "pt_BR".
  idiomaTemplate: string;
}

interface ParametroTexto {
  type: "text";
  text: string;
  parameter_name?: string;
}

interface ParametroImagem {
  type: "image";
  // A Meta aceita a imagem por media id (já hospedada nela) ou por link público.
  image: { id: string } | { link: string };
}

interface Componente {
  type: "header" | "body";
  parameters: Array<ParametroTexto | ParametroImagem>;
}

interface RespostaSucesso {
  messages?: Array<{ id?: string }>;
}

interface RespostaErro {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_data?: { details?: string };
  };
}

// A Meta aceita variáveis nomeadas ({{nome}}) ou posicionais ({{1}}), conforme o template foi criado.
// As chaves de `parametros` vêm dos placeholders do nosso texto, então elas mesmas dizem qual é o caso.
function montarParametros(parametros: Record<string, string>): ParametroTexto[] {
  const chaves = Object.keys(parametros);
  const posicionais = chaves.length > 0 && chaves.every((chave) => /^\d+$/.test(chave));

  if (posicionais) {
    return chaves
      .sort((a, b) => Number(a) - Number(b))
      .map((chave) => ({ type: "text", text: parametros[chave]! }));
  }

  return chaves.map((chave) => ({ type: "text", parameter_name: chave, text: parametros[chave]! }));
}

// A coluna aceita as duas formas: um link https, que a Meta baixa na hora do envio, ou um media id
// obtido em POST /<phone_number_id>/media. O link precisa ser acessível pelo servidor da Meta —
// URL assinada ou atrás de autenticação faz o envio falhar com 131053 (Media upload error).
function referenciaDaImagem(valor: string): { id: string } | { link: string } {
  return /^https?:\/\//i.test(valor) ? { link: valor } : { id: valor };
}

function descreverErro(status: number, corpo: RespostaErro): string {
  const erro = corpo.error;
  if (!erro) return `HTTP ${status}`;

  const partes = [erro.message ?? `HTTP ${status}`];
  if (erro.code !== undefined) partes.push(`código ${erro.code}`);
  if (erro.error_data?.details) partes.push(erro.error_data.details);
  return partes.join(" — ");
}

export class WhatsAppProviderCloudApi implements WhatsAppProvider {
  constructor(private readonly config: CloudApiConfig) {}

  async enviarTemplate(mensagem: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
    const componentes: Componente[] = [];

    // Cabeçalho de imagem: a Meta exige a imagem a cada envio, mesmo já tendo uma no template aprovado.
    if (mensagem.template.cabecalhoImagemUrl) {
      let imagem: ParametroImagem["image"];
      try {
        imagem = await this.imagemDoCabecalho(mensagem.template.cabecalhoImagemUrl);
      } catch (erro) {
        return { sucesso: false, erro: `Falha ao subir a imagem do cabeçalho para a Meta: ${erro instanceof Error ? erro.message : String(erro)}` };
      }
      componentes.push({ type: "header", parameters: [{ type: "image", image: imagem }] });
    }

    const parametros = montarParametros(mensagem.parametros);
    if (parametros.length > 0) componentes.push({ type: "body", parameters: parametros });

    return this.enviar({
      messaging_product: "whatsapp",
      to: mensagem.telefone,
      type: "template",
      template: {
        name: mensagem.template.nome,
        language: { code: mensagem.template.idioma ?? this.config.idiomaTemplate },
        // Template sem cabeçalho e sem placeholder não leva components.
        ...(componentes.length > 0 ? { components: componentes } : {}),
      },
    });
  }

  async enviarTexto(mensagem: WhatsAppTextMessage): Promise<WhatsAppSendResult> {
    return this.enviar({
      messaging_product: "whatsapp",
      to: mensagem.telefone,
      type: "text",
      text: { preview_url: false, body: mensagem.texto },
    });
  }

  // Diferente da imagem de cabeçalho de template (que aceita link público), a Cloud API não baixa áudio
  // por URL para mensagem avulsa: precisa subir o arquivo antes (POST /media) e enviar pelo id devolvido.
  async enviarAudio(mensagem: WhatsAppAudioMessage): Promise<WhatsAppSendResult> {
    let mediaId: string;
    try {
      mediaId = await this.subirMidia(mensagem.audio, mensagem.mimeType);
    } catch (erro) {
      return { sucesso: false, erro: `Falha ao subir o áudio para a Meta: ${erro instanceof Error ? erro.message : String(erro)}` };
    }

    return this.enviar({
      messaging_product: "whatsapp",
      to: mensagem.telefone,
      type: "audio",
      audio: { id: mediaId },
    });
  }

  async enviarImagem(mensagem: WhatsAppImageMessage): Promise<WhatsAppSendResult> {
    let imagem: ParametroImagem["image"];
    try {
      imagem = await this.imagemDoCabecalho(mensagem.midiaUrl);
    } catch (erro) {
      return { sucesso: false, erro: `Falha ao subir a imagem para a Meta: ${erro instanceof Error ? erro.message : String(erro)}` };
    }

    return this.enviar({
      messaging_product: "whatsapp",
      to: mensagem.telefone,
      type: "image",
      image: { ...imagem, ...(mensagem.legenda ? { caption: mensagem.legenda } : {}) },
    });
  }

  // Serve à imagem de cabeçalho de template e às imagens do agente: arquivo local sobe uma vez por número.
  private async imagemDoCabecalho(valor: string): Promise<ParametroImagem["image"]> {
    if (!valor.startsWith("/uploads/")) return referenciaDaImagem(valor);

    const chave = `${this.config.phoneNumberId}:${valor}`;
    const guardado = mediaIdPorImagem.get(chave);
    if (guardado && Date.now() - guardado.em < VALIDADE_MEDIA_ID_MS) return { id: guardado.id };

    const mimeType = valor.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    const id = await this.subirMidia(await lerMidiaLocal(valor), mimeType, "cabecalho");
    mediaIdPorImagem.set(chave, { id, em: Date.now() });
    return { id };
  }

  private async subirMidia(buffer: Buffer, mimeType: string, nomeArquivo = "audio"): Promise<string> {
    const url = `https://graph.facebook.com/${this.config.apiVersion}/${this.config.phoneNumberId}/media`;

    const formulario = new FormData();
    formulario.append("messaging_product", "whatsapp");
    formulario.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), nomeArquivo);

    const resposta = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.accessToken}` },
      body: formulario,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const texto = await resposta.text();
    const json = (texto ? JSON.parse(texto) : {}) as { id?: string } & RespostaErro;

    if (!resposta.ok || json.error) throw new Error(descreverErro(resposta.status, json));
    if (!json.id) throw new Error("A Meta não devolveu o id da mídia enviada");
    return json.id;
  }

  private async enviar(corpo: unknown): Promise<WhatsAppSendResult> {
    const url = `https://graph.facebook.com/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`;

    let resposta: Response;
    try {
      resposta = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      return { sucesso: false, erro: `Falha de rede ao chamar a Cloud API: ${motivo}` };
    }

    const texto = await resposta.text();
    let json: RespostaSucesso & RespostaErro;
    try {
      json = texto ? (JSON.parse(texto) as RespostaSucesso & RespostaErro) : {};
    } catch {
      return { sucesso: false, erro: `Resposta inesperada da Cloud API (HTTP ${resposta.status}): ${texto.slice(0, 200)}` };
    }

    if (!resposta.ok || json.error) {
      return { sucesso: false, erro: descreverErro(resposta.status, json) };
    }

    // O id aqui é só o aceite da Meta; a entrega de fato chega depois pelo webhook de status.
    return { sucesso: true, mensagemId: json.messages?.[0]?.id };
  }
}
