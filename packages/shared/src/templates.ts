const PLACEHOLDER_REGEX = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function extrairPlaceholders(conteudo: string): string[] {
  const nomes = new Set<string>();
  for (const match of conteudo.matchAll(PLACEHOLDER_REGEX)) {
    nomes.add(match[1]!);
  }
  return [...nomes];
}

export function preencherTemplate(conteudo: string, parametros: Record<string, string>): string {
  return conteudo.replace(PLACEHOLDER_REGEX, (original, nome: string) => parametros[nome] ?? original);
}
