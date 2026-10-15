-- Sessões passam a guardar só o hash (SHA-256, hex) do token do cookie. As abertas continuam valendo:
-- o token atual vira o hash dele.
UPDATE "sessoes" SET "token" = encode(sha256(convert_to("token", 'UTF8')), 'hex');
