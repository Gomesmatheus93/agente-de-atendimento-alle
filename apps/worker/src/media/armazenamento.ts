import { lerArquivo } from "@atendimento-academias/db";

// mensagens_saida.midia_url grava "/uploads/<arquivo>"; o worker lê o arquivo (do S3 ou da pasta local, ver
// packages/db/src/armazenamento.ts) para subir para a Meta.
export async function lerMidiaLocal(midiaUrl: string): Promise<Buffer> {
  return (await lerArquivo(midiaUrl)).buffer;
}
