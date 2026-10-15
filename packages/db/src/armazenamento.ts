import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Onde ficam os arquivos (áudios, figurinhas, imagens e documentos recebidos e enviados, imagens de template
// e do agente). Com S3_BUCKET configurado, num bucket da AWS — sobrevive a cada nova versão do servidor e
// é o mesmo para a API e o worker. Sem ele (no computador de desenvolvimento), numa pasta local.
// O banco guarda sempre "/uploads/<arquivo>": o endereço não muda quando o lugar muda.

const raizDoRepo = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const PREFIXO_S3 = "uploads/";

export function diretorioDeUploads(): string {
  return process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(raizDoRepo, "uploads");
}

let cliente: S3Client | null | undefined;

// Credenciais pelo padrão da AWS (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY no ambiente). S3_ENDPOINT
// permite usar um serviço compatível (Cloudflare R2, MinIO...).
function clienteS3(): S3Client | null {
  if (cliente !== undefined) return cliente;
  const bucket = process.env.S3_BUCKET?.trim();
  if (!bucket) return (cliente = null);
  cliente = new S3Client({
    region: process.env.S3_REGION?.trim() || process.env.AWS_REGION?.trim() || "sa-east-1",
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT.trim(), forcePathStyle: true } : {}),
  });
  return cliente;
}

export function armazenamentoNoS3(): boolean {
  return clienteS3() !== null;
}

const EXTENSAO_POR_MIME: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
};

const MIME_POR_EXTENSAO: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSAO_POR_MIME).map(([mime, extensao]) => [extensao, mime]),
);

export function extensaoDoMime(mimeType: string): string {
  // "audio/ogg; codecs=opus" -> "audio/ogg": só a parte antes do ";" importa.
  const base = mimeType.split(";")[0]!.trim().toLowerCase();
  return EXTENSAO_POR_MIME[base] ?? "bin";
}

export function mimeDoArquivo(nome: string): string {
  return MIME_POR_EXTENSAO[path.extname(nome).slice(1).toLowerCase()] ?? "application/octet-stream";
}

// Só o nome do arquivo, sem pasta: "/uploads/../../etc" não vira um jeito de ler outra coisa.
export function nomeDoArquivo(urlOuNome: string): string {
  return path.basename(urlOuNome.split("?")[0]!);
}

export interface ArquivoSalvo {
  url: string;
  bytes: number;
}

export async function salvarArquivo(buffer: Buffer, mimeType: string): Promise<ArquivoSalvo> {
  const nome = `${randomUUID()}.${extensaoDoMime(mimeType)}`;
  const s3 = clienteS3();
  if (s3) {
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET!.trim(),
        Key: PREFIXO_S3 + nome,
        Body: buffer,
        ContentType: mimeType.split(";")[0]!.trim(),
        // Arquivos de clientes: nunca públicos; quem lê é a API (com sessão) e o worker.
        ServerSideEncryption: process.env.S3_ENDPOINT ? undefined : "AES256",
      }),
    );
  } else {
    const pasta = diretorioDeUploads();
    await mkdir(pasta, { recursive: true });
    await writeFile(path.join(pasta, nome), buffer);
  }
  return { url: `/uploads/${nome}`, bytes: buffer.byteLength };
}

export function salvarArquivoBase64(base64: string, mimeType: string): Promise<ArquivoSalvo> {
  return salvarArquivo(Buffer.from(base64, "base64"), mimeType);
}

export class ArquivoNaoEncontrado extends Error {}

export async function lerArquivo(urlOuNome: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const nome = nomeDoArquivo(urlOuNome);
  const s3 = clienteS3();
  if (s3) {
    try {
      const resposta = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET!.trim(), Key: PREFIXO_S3 + nome }));
      const bytes = await resposta.Body!.transformToByteArray();
      return { buffer: Buffer.from(bytes), mimeType: resposta.ContentType ?? mimeDoArquivo(nome) };
    } catch (erro) {
      // Arquivo de antes do S3 que ainda está na pasta local (enquanto a migração não roda): tenta o disco.
      if (!(erro instanceof NoSuchKey)) throw erro;
    }
  }
  try {
    return { buffer: await readFile(path.join(diretorioDeUploads(), nome)), mimeType: mimeDoArquivo(nome) };
  } catch {
    throw new ArquivoNaoEncontrado(`Arquivo ${nome} não encontrado`);
  }
}

// Para a tela de saúde: o bucket responde com estas credenciais? Sem S3 configurado, devolve null.
export async function verificarArmazenamento(): Promise<string | null> {
  const s3 = clienteS3();
  if (!s3) return null;
  await s3.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET!.trim() }), { abortSignal: AbortSignal.timeout(10_000) });
  return process.env.S3_BUCKET!.trim();
}

// Apaga o arquivo (pedido de exclusão de dados, retenção). Do S3 e, se ainda houver cópia, da pasta local.
export async function apagarArquivo(urlOuNome: string): Promise<void> {
  const nome = nomeDoArquivo(urlOuNome);
  const s3 = clienteS3();
  if (s3) await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET!.trim(), Key: PREFIXO_S3 + nome }));
  await rm(path.join(diretorioDeUploads(), nome), { force: true });
}
