// Freio contra adivinhar senha: conta as tentativas erradas em memória, por IP + e-mail (protege a conta)
// e por IP sozinho (protege contra testar muitos e-mails). Reiniciar a API zera a contagem — aceitável para
// um único processo; com várias réplicas, isso precisaria ir para o Redis.

const JANELA_MS = 15 * 60_000;
const MAX_POR_CONTA = 5;
const MAX_POR_IP = 20;

interface Contagem {
  falhas: number;
  desde: number;
}

const falhas = new Map<string, Contagem>();

function ativa(chave: string, agora: number): Contagem | undefined {
  const contagem = falhas.get(chave);
  if (contagem && agora - contagem.desde > JANELA_MS) {
    falhas.delete(chave);
    return undefined;
  }
  return contagem;
}

const chaves = (ip: string, email: string) => [`conta:${ip}:${email.toLowerCase()}`, `ip:${ip}`] as const;

// Minutos até liberar de novo, ou null se pode tentar.
export function minutosBloqueado(ip: string, email: string): number | null {
  const agora = Date.now();
  const [chaveConta, chaveIp] = chaves(ip, email);
  const limites: Array<[string, number]> = [
    [chaveConta, MAX_POR_CONTA],
    [chaveIp, MAX_POR_IP],
  ];
  for (const [chave, maximo] of limites) {
    const contagem = ativa(chave, agora);
    if (contagem && contagem.falhas >= maximo) return Math.max(1, Math.ceil((contagem.desde + JANELA_MS - agora) / 60_000));
  }
  return null;
}

export function registrarFalha(ip: string, email: string): void {
  const agora = Date.now();
  for (const chave of chaves(ip, email)) {
    const contagem = ativa(chave, agora);
    if (contagem) contagem.falhas += 1;
    else falhas.set(chave, { falhas: 1, desde: agora });
  }
  // Não deixa o mapa crescer sem fim se alguém varrer muitos e-mails.
  if (falhas.size > 10_000) {
    for (const [chave, contagem] of falhas) if (agora - contagem.desde > JANELA_MS) falhas.delete(chave);
  }
}

// Acertou a senha: libera a conta, mas mantém a contagem do IP.
export function limparFalhas(ip: string, email: string): void {
  falhas.delete(chaves(ip, email)[0]);
}
