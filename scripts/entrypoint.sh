#!/bin/sh
# Sobe como root só para acertar o dono da pasta de arquivos (o volume do easypanel pode ter sido criado
# por root em versões anteriores) e logo troca para o usuário "node": a aplicação nunca roda como root.
set -e
mkdir -p /app/uploads
chown -R node:node /app/uploads 2>/dev/null || true
export HOME=/home/node USER=node
exec setpriv --reuid=node --regid=node --init-groups --inh-caps=-all "$@"
