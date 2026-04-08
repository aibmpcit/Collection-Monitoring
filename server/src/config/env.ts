import fs from "fs";
import path from "path";
import dotenv from "dotenv";

function resolveEnvPath() {
  const candidates = [
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
