const VERSAO_PADRAO = "v25.0";

export function versaoDaApi(): string {
  return process.env.WHATSAPP_API_VERSION ?? VERSAO_PADRAO;
}

interface ErroDaMeta {
  // error_user_msg é a explicação pensada para quem usa (ex.: por que o template foi recusado na criação).
  error?: { message?: string; code?: number; error_subcode?: number; error_user_title?: string; error_user_msg?: string };
}

export class ErroGraph extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codigo?: number,
  ) {
    super(message);
  }
}

interface OpcoesPedido {
  metodo?: "GET" | "POST";
  // Objeto vira JSON; Buffer vai cru (upload de arquivo).
  corpo?: unknown;
  cabecalhos?: Record<string, string>;
}

async function pedir<T>(caminho: string, token: string, opcoes: OpcoesPedido = {}): Promise<T> {
  const corpoCru = Buffer.isBuffer(opcoes.corpo);
  let resposta: Response;
  try {
    resposta = await fetch(`https://graph.facebook.com/${versaoDaApi()}/${caminho}`, {
      method: opcoes.metodo ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opcoes.corpo !== undefined && !corpoCru ? { "Content-Type": "application/json" } : {}),
        ...opcoes.cabecalhos,
      },
      body:
        opcoes.corpo === undefined
          ? undefined
          : corpoCru
            ? new Uint8Array(opcoes.corpo as Buffer)
            : JSON.stringify(opcoes.corpo),
      signal: AbortSignal.timeout(opcoes.corpo === undefined ? 20_000 : 60_000),
    });
  } catch (erro) {
    throw new ErroGraph(`Não foi possível falar com a Meta: ${erro instanceof Error ? erro.message : String(erro)}`, 0);
  }

  const texto = await resposta.text();
  let corpo: (T & ErroDaMeta) | ErroDaMeta;
  try {
    corpo = texto ? JSON.parse(texto) : {};
  } catch {
    throw new ErroGraph(`Resposta inesperada da Meta (HTTP ${resposta.status})`, resposta.status);
  }

  if (!resposta.ok || (corpo as ErroDaMeta).error) {
    const erro = (corpo as ErroDaMeta).error;
    const mensagem = erro?.error_user_msg ? `${erro.error_user_title ? `${erro.error_user_title}: ` : ""}${erro.error_user_msg}` : erro?.message;
    throw new ErroGraph(mensagem ?? `HTTP ${resposta.status}`, resposta.status, erro?.code);
  }
  return corpo as T;
}

export interface ContaDaMeta {
  id: string;
  name?: string;
}

export interface NumeroDaMeta {
  id: string;
  display_phone_number: string;
  verified_name?: string;
  quality_rating?: string;
}

export function buscarConta(wabaId: string, token: string): Promise<ContaDaMeta> {
  return pedir<ContaDaMeta>(`${wabaId}?fields=id,name`, token);
}

export async function listarNumeros(wabaId: string, token: string): Promise<NumeroDaMeta[]> {
  const resposta = await pedir<{ data?: NumeroDaMeta[] }>(
    `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating&limit=50`,
    token,
  );
  return resposta.data ?? [];
}

export interface TemplateDaMeta {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  parameter_format?: string;
  components?: Array<{ type: string; format?: string; text?: string }>;
}

export interface TemplateCriadoNaMeta {
  id: string;
  status: string;
  category: string;
}

// Corpo no formato de POST /<waba>/message_templates; quem monta é o router de templates.
export function criarTemplateNaMeta(wabaId: string, token: string, corpo: Record<string, unknown>): Promise<TemplateCriadoNaMeta> {
  return pedir<TemplateCriadoNaMeta>(`${wabaId}/message_templates`, token, { metodo: "POST", corpo });
}

// A imagem de exemplo do cabeçalho vai pela Resumable Upload API, que pede o id do app dono do token.
async function descobrirAppId(token: string): Promise<string> {
  try {
    const app = await pedir<{ id?: string }>("app", token);
    if (app.id) return app.id;
  } catch {
    // Alguns tipos de token não respondem em /app; debug_token cobre esses.
  }
  const depuracao = await pedir<{ data?: { app_id?: string } }>(`debug_token?input_token=${encodeURIComponent(token)}`, token);
  if (!depuracao.data?.app_id) throw new ErroGraph("Não foi possível descobrir o app da Meta dono deste token", 0);
  return depuracao.data.app_id;
}

// Devolve o "handle" da Resumable Upload API: é o que a Meta pede em example.header_handle (imagem de
// template) e em profile_picture_handle (foto do perfil do número).
export async function subirImagemParaHandle(token: string, imagem: Buffer, mimeType: string, nomeArquivo = "imagem"): Promise<string> {
  const appId = await descobrirAppId(token);
  const extensao = mimeType === "image/png" ? "png" : "jpg";
  const sessao = await pedir<{ id?: string }>(
    `${appId}/uploads?file_name=${nomeArquivo}.${extensao}&file_length=${imagem.byteLength}&file_type=${encodeURIComponent(mimeType)}`,
    token,
    { metodo: "POST" },
  );
  if (!sessao.id) throw new ErroGraph("A Meta não abriu a sessão de upload da imagem", 0);

  // Este passo usa "OAuth <token>" em vez de Bearer, como manda a documentação da Resumable Upload API.
  const enviado = await pedir<{ h?: string }>(sessao.id, token, {
    metodo: "POST",
    corpo: imagem,
    cabecalhos: { Authorization: `OAuth ${token}`, file_offset: "0" },
  });
  if (!enviado.h) throw new ErroGraph("A Meta não devolveu a referência da imagem enviada", 0);
  return enviado.h;
}

export async function listarTemplates(wabaId: string, token: string): Promise<TemplateDaMeta[]> {
  const resposta = await pedir<{ data?: TemplateDaMeta[] }>(
    `${wabaId}/message_templates?fields=id,name,language,status,category,parameter_format,components&limit=250`,
    token,
  );
  return resposta.data ?? [];
}

export interface MidiaDaMeta {
  buffer: Buffer;
  mimeType: string;
}

// Mensagem de mídia (áudio, figurinha, imagem) chega no webhook só com um id; o conteúdo é baixado à
// parte, em dois passos: GET /<media-id> devolve uma URL temporária, e essa URL exige o mesmo Bearer.
export async function baixarMidia(mediaId: string, token: string): Promise<MidiaDaMeta> {
  const metadados = await pedir<{ url?: string; mime_type?: string }>(mediaId, token);
  if (!metadados.url) throw new ErroGraph("A Meta não devolveu a URL de download da mídia", 0);

  let resposta: Response;
  try {
    resposta = await fetch(metadados.url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (erro) {
    throw new ErroGraph(`Não foi possível baixar a mídia da Meta: ${erro instanceof Error ? erro.message : String(erro)}`, 0);
  }
  if (!resposta.ok) throw new ErroGraph(`Falha ao baixar mídia (HTTP ${resposta.status})`, resposta.status);

  const buffer = Buffer.from(await resposta.arrayBuffer());
  return { buffer, mimeType: metadados.mime_type ?? resposta.headers.get("content-type") ?? "application/octet-stream" };
}

// Perfil comercial do número (o que o cliente vê ao tocar no contato no WhatsApp). O nome exibido não
// entra aqui: trocá-lo passa por análise da Meta no Gerenciador do WhatsApp.
export interface PerfilDoNumero {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  profile_picture_url?: string;
  websites?: string[];
  vertical?: string;
}

export async function buscarPerfilDoNumero(phoneNumberId: string, token: string): Promise<PerfilDoNumero> {
  const resposta = await pedir<{ data?: PerfilDoNumero[] }>(
    `${phoneNumberId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`,
    token,
  );
  return resposta.data?.[0] ?? {};
}

export async function atualizarPerfilDoNumero(
  phoneNumberId: string,
  token: string,
  perfil: Omit<PerfilDoNumero, "profile_picture_url"> & { profile_picture_handle?: string },
): Promise<void> {
  await pedir(`${phoneNumberId}/whatsapp_business_profile`, token, {
    metodo: "POST",
    corpo: { messaging_product: "whatsapp", ...perfil },
  });
}
