import { lerContagem, somarContagem, zerarContagem } from "../limites.js";

// Freio contra adivinhar senha: conta as tentativas erradas por IP + e-mail (protege a conta) e por IP
// sozinho (protege contra testar muitos e-mails). A contagem fica no Redis (limites.ts): reiniciar ou
// publicar uma versão nova não zera o bloqueio.

const JANELA_MS = 15 * 60_000;
const MAX_POR_CONTA = 5;
const MAX_POR_IP = 20;

const chaves = (ip: string, email: string) => [`login:conta:${ip}:${email.toLowerCase()}`, `login:ip:${ip}`] as const;

// Minutos até liberar de novo, ou null se pode tentar.
export async function minutosBloqueado(ip: string, email: string): Promise<number | null> {
  const [chaveConta, chaveIp] = chaves(ip, email);
  const limites: Array<[string, number]> = [
    [chaveConta, MAX_POR_CONTA],
    [chaveIp, MAX_POR_IP],
  ];
  for (const [chave, maximo] of limites) {
    const { total, restanteMs } = await lerContagem(chave);
    if (total >= maximo) return Math.max(1, Math.ceil(restanteMs / 60_000));
  }
  return null;
}

export async function registrarFalha(ip: string, email: string): Promise<void> {
  await Promise.all(chaves(ip, email).map((chave) => somarContagem(chave, JANELA_MS)));
}

// Acertou a senha: libera a conta, mas mantém a contagem do IP.
export async function limparFalhas(ip: string, email: string): Promise<void> {
  await zerarContagem(chaves(ip, email)[0]);
}
