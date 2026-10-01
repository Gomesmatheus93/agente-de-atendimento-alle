import Anthropic from "@anthropic-ai/sdk";

// Chave da organização (não presa a um workspace) exige dizer em qual workspace cada pedido roda; a
// Anthropic recusa sem o header. Com chave criada dentro de um workspace, ANTHROPIC_WORKSPACE_ID fica vazio.
export function criarClienteAnthropic(): Anthropic {
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {});
}
