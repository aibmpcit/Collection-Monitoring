import { defineConfig, devices } from "@playwright/test";
import { API_PORT, CLIENT_PORT } from "./e2e/ports";

// End-to-end tests (e2e/). They run the real API and client against a separate test database,
// never the main one. See e2e/README.md for the one-time database setup.
const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "mysql://root@127.0.0.1:3306/cm_e2e";

export default defineConfig({
  testDir: "./e2e",
  // The tests share one database, so they run one at a time.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } }
  ],
  webServer: [
    {
      command: "npm run dev --workspace server",
      url: `http://localhost:${API_PORT}/api/health`,
      env: { DATABASE_URL: E2E_DATABASE_URL, JWT_SECRET: "e2e-test-secret", PORT: String(API_PORT), GEOCODER: "off" },
      // Never reuse a running API: it could be connected to the main database.
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: `npm run dev --workspace client -- --port ${CLIENT_PORT} --strictPort`,
      url: `http://localhost:${CLIENT_PORT}`,
      // "/api" overrides any VITE_API_BASE_URL in .env.local, so every request goes through the
      // proxy to the test API instead of a dev API on port 4000.
      env: { VITE_API_BASE_URL: "/api", VITE_DEV_API_PROXY_TARGET: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
});
