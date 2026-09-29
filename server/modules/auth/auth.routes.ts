import { Router } from "express";
import { requireAuth } from "../../lib/auth.js";
import { validateBody } from "../../lib/validate.js";
import { loginRateLimit, registerRateLimit } from "../../lib/rateLimit.js";
import * as authController from "./auth.controller.js";
import { loginSchema, registerSchema } from "./auth.schemas.js";

export const authRouter = Router();

// el rate limit va antes de validar el body: contar los intentos también
// tiene que contar los que ni siquiera son requests válidos (un attacker que
// manda basura no debería poder saltarse el límite por mandar basura)
authRouter.post(
  "/register",
  registerRateLimit,
  validateBody(registerSchema),
  authController.register
);
authRouter.post(
  "/login",
  loginRateLimit,
  validateBody(loginSchema),
  authController.login
);
authRouter.get("/me", requireAuth, authController.me);
// logout real: revoca el token del lado del server. Va con requireAuth porque
// necesita el token presente para poder anotarlo como revocado; si el token ya
// no sirve, el cliente igual lo borra y no hay nada que hacer acá.
authRouter.post("/logout", requireAuth, authController.logout);
