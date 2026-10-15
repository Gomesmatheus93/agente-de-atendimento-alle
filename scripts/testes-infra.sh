#!/bin/sh
# Sobe um Postgres e um Redis só para os testes automáticos (podman ou docker), em portas próprias.
# Nunca usa o banco do Supabase: os testes apagam e recriam tudo a cada execução.
set -e
CLI=$(command -v podman || command -v docker || true)
[ -z "$CLI" ] && { echo "Instale o podman ou o docker para rodar os testes."; exit 1; }

if ! $CLI ps --format '{{.Names}}' | grep -q '^allpchat-teste-pg$'; then
  $CLI rm -f allpchat-teste-pg >/dev/null 2>&1 || true
  $CLI run -d --name allpchat-teste-pg -p 127.0.0.1:55432:5432 \
    -e POSTGRES_USER=teste -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=allpchat_teste \
    docker.io/library/postgres:16-alpine >/dev/null
fi
if ! $CLI ps --format '{{.Names}}' | grep -q '^allpchat-teste-redis$'; then
  $CLI rm -f allpchat-teste-redis >/dev/null 2>&1 || true
  $CLI run -d --name allpchat-teste-redis -p 127.0.0.1:56379:6379 docker.io/library/redis:7-alpine >/dev/null
fi
# Espera o Postgres aceitar conexão.
for i in $(seq 1 30); do
  $CLI exec allpchat-teste-pg pg_isready -U teste -d allpchat_teste >/dev/null 2>&1 && break
  sleep 1
done
echo "Banco e Redis de teste prontos (127.0.0.1:55432 e 127.0.0.1:56379)."
