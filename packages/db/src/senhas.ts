import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derivar = promisify(scrypt) as (senha: string, sal: Buffer, tamanho: number) => Promise<Buffer>;
const TAMANHO = 64;

export async function gerarHashDeSenha(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const derivado = await derivar(senha, sal, TAMANHO);
  return `scrypt$${sal.toString("hex")}$${derivado.toString("hex")}`;
}

export async function senhaConfere(senha: string, hash: string): Promise<boolean> {
  const [algoritmo, salHex, derivadoHex] = hash.split("$");
  if (algoritmo !== "scrypt" || !salHex || !derivadoHex) return false;

  const esperado = Buffer.from(derivadoHex, "hex");
  const calculado = await derivar(senha, Buffer.from(salHex, "hex"), esperado.length);
  return esperado.length === calculado.length && timingSafeEqual(esperado, calculado);
}
