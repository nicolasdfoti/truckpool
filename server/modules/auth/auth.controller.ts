import type { Request, Response } from "express";
import * as authService from "./auth.service.js";
import { AppError } from "../../lib/errors.js";

export async function register(req: Request, res: Response) {
  const result = await authService.registerUser(req.body);
  res.status(201).json(result);
}

export async function login(req: Request, res: Response) {
  const result = await authService.loginUser(req.body);
  res.json(result);
}

export async function me(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("no autenticado", 401, "UNAUTHORIZED");
  }
  const user = await authService.getCurrentUser(req.user.id);
  res.json({ user });
}

export async function logout(req: Request, res: Response) {
  await authService.logoutUser(req.token);
  // 204: el token ya no sirve, no hay cuerpo que devolver
  res.status(204).end();
}
