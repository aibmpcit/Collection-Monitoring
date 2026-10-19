// Ports for the end-to-end test servers, shared by playwright.config.ts and the tests.
// They differ from `npm run dev` (API 4000, client 5173) so both can run at once.
// Override with E2E_API_PORT / E2E_CLIENT_PORT, e.g. to run tests while the UI mode window is open.
export const API_PORT = Number(process.env.E2E_API_PORT ?? 4100);
export const CLIENT_PORT = Number(process.env.E2E_CLIENT_PORT ?? 5180);
export const API_BASE = `http://localhost:${API_PORT}/api`;
