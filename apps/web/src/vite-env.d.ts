/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  // Telefones de teste que já vêm preenchidos em Nova campanha (vírgula separa). Vazio em produção.
  readonly VITE_TELEFONES_TESTE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
