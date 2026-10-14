import { router } from "./trpc.js";
import { authRouter } from "./routers/auth.js";
import { calendarioRouter } from "./routers/calendario.js";
import { campanhasRouter } from "./routers/campanhas.js";
import { configuracoesRouter } from "./routers/configuracoes.js";
import { conversasRouter } from "./routers/conversas.js";
import { dashboardRouter } from "./routers/dashboard.js";
import { descadastrosRouter } from "./routers/descadastros.js";
import { duvidasRouter } from "./routers/duvidas.js";
import { evoRouter } from "./routers/evo.js";
import { funilRouter } from "./routers/funil.js";
import { instagramRouter } from "./routers/instagram.js";
import { relatoriosRouter } from "./routers/relatorios.js";
import { saudeRouter } from "./routers/saude.js";
import { templatesRouter } from "./routers/templates.js";
import { unidadesRouter } from "./routers/unidades.js";
import { usuariosRouter } from "./routers/usuarios.js";

export const appRouter = router({
  auth: authRouter,
  calendario: calendarioRouter,
  campanhas: campanhasRouter,
  configuracoes: configuracoesRouter,
  conversas: conversasRouter,
  dashboard: dashboardRouter,
  descadastros: descadastrosRouter,
  duvidas: duvidasRouter,
  evo: evoRouter,
  funil: funilRouter,
  instagram: instagramRouter,
  relatorios: relatoriosRouter,
  saude: saudeRouter,
  templates: templatesRouter,
  unidades: unidadesRouter,
  usuarios: usuariosRouter,
});

export type AppRouter = typeof appRouter;
