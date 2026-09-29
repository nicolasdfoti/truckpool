-- Tokens de sesión revocados (logout real).
--
-- El JWT no se puede desfirmar, así que un token robado seguía siendo válido
-- durante los 7 días de su expiración aunque el usuario cerrara sesión. Se
-- guarda el `jti` de cada token cerrado; `requireAuth` lo consulta antes de
-- autorizar el request.
CREATE TABLE "RevokedToken" (
    "jti" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevokedToken_pkey" PRIMARY KEY ("jti")
);

-- la limpieza de filas vencidas borra por expiresAt
CREATE INDEX "RevokedToken_expiresAt_idx" ON "RevokedToken"("expiresAt");
