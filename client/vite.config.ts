import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  base: mode === "production" ? process.env.VITE_BASE_PATH || "/" : "/",
  envDir: "..",
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/testSetup.ts"
  }
}));
