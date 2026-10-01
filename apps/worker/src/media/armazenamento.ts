import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Mesma pasta que a API usa (apps/api/src/media/armazenamento.ts): local, compartilhada por rodar tudo
// na mesma máquina. Precisa apontar para o mesmo lugar nos dois .env (UPLOADS_DIR), senão o worker não
// acha o arquivo que a API acabou de gravar.
const raizDoRepo = path.resolve(fileURLToPath(new URL("../../../../", import.meta.url)));

function diretorioDeUploads(): string {
  return process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(raizDoRepo, "uploads");
}

// mensagens_saida.midia_url grava um caminho tipo "/uploads/<arquivo>", servido pela API; o worker lê o
// mesmo arquivo direto do disco para subir para a Meta. path.basename corta qualquer coisa antes do nome
// do arquivo, então midiaUrl não vira um jeito de ler outro caminho do disco.
export function lerMidiaLocal(midiaUrl: string): Promise<Buffer> {
  const nome = path.basename(midiaUrl);
  return readFile(path.join(diretorioDeUploads(), nome));
}
