// O armazenamento de arquivos mora no pacote comum (packages/db/src/armazenamento.ts): S3 no servidor, pasta
// local no desenvolvimento. Estes nomes continuam valendo para quem já os importava.
export { diretorioDeUploads, salvarArquivo as salvarBuffer, salvarArquivoBase64 as salvarBase64 } from "@atendimento-academias/db";
