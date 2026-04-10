const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "client", "dist");
const target = path.join(root, "dist");

if (!fs.existsSync(source)) {
  throw new Error(`Expected client build output at ${source}`);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
