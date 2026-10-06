import { router } from "./trpc.js";
import { authRouter } from "./routers/auth.js";
import { calendarioRouter } from "./routers/calendario.js";
import { campanhasRouter } from "./routers/campanhas.js";
import { configuracoesRouter } from "./routers/configuracoes.js";
import { conversasRouter } from "./routers/conversas.js";
import { dashboardRouter } from "./routers/dashboard.js";
import { duvidasRouter } from "./routers/duvidas.js";
import { funilRouter } from "./routers/funil.js";
import { relatoriosRouter } from "./routers/relatorios.js";
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
  duvidas: duvidasRouter,
  funil: funilRouter,
  relatorios: relatoriosRouter,
  templates: templatesRouter,
  unidades: unidadesRouter,
  usuarios: usuariosRouter,
});

export type AppRouter = typeof appRouter;
