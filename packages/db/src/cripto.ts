import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Credenciais do WhatsApp ficam cifradas no banco. A chave mestra não pode ficar lá junto: vem da
// variável CHAVE_CRIPTOGRAFIA ou, quando ela não existe, de um arquivo local criado na primeira vez.
// Assim dá para configurar tudo pela plataforma sem editar .env, e um dump do banco não entrega o token.
const ARQUIVO_CHAVE = fileURLToPath(new URL("../../../.chave-criptografia", import.meta.url));

let chaveEmMemoria: Buffer | undefined;

function carregarChave(): Buffer {
  if (chaveEmMemoria) return chaveEmMemoria;

  const daVariavel = process.env.CHAVE_CRIPTOGRAFIA?.trim();
  if (daVariavel) {
    const chave = Buffer.from(daVariavel, "base64");
    if (chave.length !== 32) throw new Error("CHAVE_CRIPTOGRAFIA precisa ter 32 bytes em base64");
    chaveEmMemoria = chave;
    return chave;
  }

  if (existsSync(ARQUIVO_CHAVE)) {
    chaveEmMemoria = Buffer.from(readFileSync(ARQUIVO_CHAVE, "utf8").trim(), "base64");
    if (chaveEmMemoria.length !== 32) throw new Error(`Chave inválida em ${ARQUIVO_CHAVE}`);
    return chaveEmMemoria;
  }

  const nova = randomBytes(32);
  mkdirSync(dirname(ARQUIVO_CHAVE), { recursive: true });
  writeFileSync(ARQUIVO_CHAVE, nova.toString("base64"), { mode: 0o600 });
  try {
    chmodSync(ARQUIVO_CHAVE, 0o600);
  } catch {
    // Windows ignora o modo; o arquivo fica fora do git de qualquer forma.
  }
  console.warn(`[cripto] chave criada em ${ARQUIVO_CHAVE}. Guarde uma cópia: sem ela, as credenciais salvas não podem ser lidas.`);
  chaveEmMemoria = nova;
  return nova;
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", carregarChave(), iv);
  const dados = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()]);
  return ["v1", iv.toString("base64"), cifra.getAuthTag().toString("base64"), dados.toString("base64")].join(":");
}

export function decifrar(guardado: string): string {
  const [versao, ivB64, tagB64, dadosB64] = guardado.split(":");
  if (versao !== "v1" || !ivB64 || !tagB64 || !dadosB64) throw new Error("Valor cifrado em formato desconhecido");

  const decifra = createDecipheriv("aes-256-gcm", carregarChave(), Buffer.from(ivB64, "base64"));
  decifra.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decifra.update(Buffer.from(dadosB64, "base64")), decifra.final()]).toString("utf8");
}

// Para mostrar na tela sem revelar o segredo.
export function mascarar(valor: string, visiveis = 4): string {
  return valor.length <= visiveis ? "•".repeat(valor.length) : `••••${valor.slice(-visiveis)}`;
}
