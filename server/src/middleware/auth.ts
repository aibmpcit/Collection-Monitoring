import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { JwtUser, Role } from "../types/models.js";

interface AuthedRequest extends Request {
  user?: JwtUser;
}

export function authenticate(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authentication token missing" });
  }

  const token = authHeader.slice("Bearer ".length);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET ?? "") as JwtUser;
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

export function authorize(roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    return next();
  };
}

export type { AuthedRequest };
