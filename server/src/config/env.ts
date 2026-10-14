import fs from "fs";
import path from "path";
import dotenv from "dotenv";

function resolveEnvPath() {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "../.env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../.env")
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

dotenv.config({ path: resolveEnvPath() });

/**
 * Production rule: remarks are imported once per branch (its first import, by a super admin),
 * then locked. Off while the system is being tested, so every import may bring in remarks.
 */
export function remarkImportOnce() {
  return process.env.REMARK_IMPORT_ONCE === "true";
}

export function requiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}
