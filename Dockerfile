# Allp Chat: API (painel + webhook) e worker num container só, para o easypanel.
# Monta o painel (vite build) e roda o TypeScript direto com tsx, como em desenvolvimento.
FROM node:22-slim

# Mesma versão do pnpm usada no desenvolvimento (o lockfile é dela).
RUN npm install -g pnpm@12.6.0
WORKDIR /app

# Dependências primeiro: enquanto os package.json não mudam, essa etapa vem do cache e o deploy é rápido.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .

# O painel chama a API pela mesma origem (/trpc); variáveis VITE_ entram aqui, na montagem.
ARG VITE_API_URL=/trpc
ARG VITE_TELEFONES_TESTE=
RUN VITE_API_URL=$VITE_API_URL VITE_TELEFONES_TESTE=$VITE_TELEFONES_TESTE pnpm --filter @atendimento-academias/web build

ENV NODE_ENV=production \
    WEB_DIST=/app/apps/web/dist \
    PAINEL_HOST=0.0.0.0 \
    PAINEL_PORT=3334 \
    WEBHOOK_PORT=3333

# 3334: painel (login, telas). 3333: webhook da Meta e /integracoes do n8n.
EXPOSE 3334 3333
# Áudios, figurinhas e imagens do agente: montar um volume aqui para não perder a cada deploy.
VOLUME ["/app/uploads"]

CMD ["node", "scripts/iniciar-producao.mjs"]
