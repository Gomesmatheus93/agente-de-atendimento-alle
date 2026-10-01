import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Uma pasta só, compartilhada com o worker: a API grava aqui o que chega pelo webhook (áudio, figurinha)
// e o que a equipe grava pela tela de Conversas (nota de voz); o worker lê da mesma pasta para subir a
// mídia de saída para a Meta. Local porque o projeto não tem (ainda) um serviço de armazenamento externo —
// dá para trocar por S3/R2 no futuro só trocando esta função, sem mexer em quem grava e lê.
const raizDoRepo = path.resolve(fileURLToPath(new URL("../../../../", import.meta.url)));

export function diretorioDeUploads(): string {
  return process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(raizDoRepo, "uploads");
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
};

function extensaoDoMime(mimeType: string): string {
  // "audio/ogg; codecs=opus" -> "audio/ogg": o navegador manda o codec junto, mas só a parte antes do ";" importa aqui.
  const base = mimeType.split(";")[0]!.trim().toLowerCase();
  return EXTENSAO_POR_MIME[base] ?? "bin";
}

interface ArquivoSalvo {
  // Caminho servido pela API (ver painel.use("/uploads", ...) em index.ts); é o que vai para o banco.
  url: string;
  caminho: string;
  bytes: number;
}

async function salvarBuffer(buffer: Buffer, mimeType: string): Promise<ArquivoSalvo> {
  const pasta = diretorioDeUploads();
  await mkdir(pasta, { recursive: true });
  const nome = `${randomUUID()}.${extensaoDoMime(mimeType)}`;
  const caminho = path.join(pasta, nome);
  await writeFile(caminho, buffer);
  return { url: `/uploads/${nome}`, caminho, bytes: buffer.byteLength };
}

// Áudio gravado no navegador e mandado como base64 pelo tRPC (enviarAudio).
export function salvarBase64(base64: string, mimeType: string): Promise<ArquivoSalvo> {
  return salvarBuffer(Buffer.from(base64, "base64"), mimeType);
}

export { salvarBuffer };
