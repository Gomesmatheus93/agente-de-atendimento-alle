import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { diretorioDeUploads, mimeDoArquivo } from "./armazenamento.js";

// Copia para o bucket os arquivos que estão na pasta local de uploads (os de antes do S3). Pode rodar mais
// de uma vez: o que já está no bucket é pulado. Uso: pnpm --filter @atendimento-academias/db migrar:s3
const bucket = process.env.S3_BUCKET?.trim();
if (!bucket) {
  console.error("Configure S3_BUCKET (e as credenciais da AWS) no .env antes de migrar.");
  process.exit(1);
}
const s3 = new S3Client({
  region: process.env.S3_REGION?.trim() || process.env.AWS_REGION?.trim() || "sa-east-1",
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT.trim(), forcePathStyle: true } : {}),
});

const pasta = diretorioDeUploads();
const arquivos = (await readdir(pasta).catch(() => [] as string[])).filter((nome) => !nome.startsWith("."));
let enviados = 0;
let pulados = 0;
for (const nome of arquivos) {
  const chave = `uploads/${nome}`;
  const existe = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: chave })).then(() => true, () => false);
  if (existe) {
    pulados += 1;
    continue;
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: chave,
      Body: await readFile(path.join(pasta, nome)),
      ContentType: mimeDoArquivo(nome),
      ServerSideEncryption: process.env.S3_ENDPOINT ? undefined : "AES256",
    }),
  );
  enviados += 1;
}
console.log(`${enviados} arquivo(s) enviados para s3://${bucket}/uploads, ${pulados} já estavam lá (pasta: ${pasta}).`);
process.exit(0);
