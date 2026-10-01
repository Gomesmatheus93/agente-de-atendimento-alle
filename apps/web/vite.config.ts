import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Mesma origem para o navegador: sem CORS, e o cookie de sessão vale para as chamadas da API.
    proxy: {
      "/trpc": { target: process.env.PAINEL_API_URL ?? "http://127.0.0.1:3334", changeOrigin: false },
      // Áudio de nota de voz e figurinha recebida: arquivos servidos pela API (apps/api/src/media).
      "/uploads": { target: process.env.PAINEL_API_URL ?? "http://127.0.0.1:3334", changeOrigin: false },
    },
  },
});
