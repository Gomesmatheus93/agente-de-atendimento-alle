// Erros de validação do zod chegam como JSON no message; para o usuário mostramos algo legível.
export function mensagemDeErro(erro: { message: string }): string {
  if (erro.message.trimStart().startsWith("[")) {
    return "Alguns dados estão inválidos. Revise os passos e tente novamente.";
  }
  if (erro.message === "Failed to fetch") {
    return "Não foi possível falar com o servidor. Verifique sua conexão e tente novamente.";
  }
  return erro.message;
}
