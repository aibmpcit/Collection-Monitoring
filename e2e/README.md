# End-to-end tests (Playwright)

These tests drive the real app in a browser: the API, the React client and a MySQL database.
They use a **separate test database (`cm_e2e`)**, never `collection_monitoring`.

## One-time setup

```bash
npx playwright install chromium

# Test database: base schema (without its USE line, so it only touches cm_e2e), then migrations.
mysql -uroot -h127.0.0.1 -e "CREATE DATABASE IF NOT EXISTS cm_e2e CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sed -e '/^CREATE DATABASE/,/;/d' -e '/^USE /d' database/schema.mysql.sql | mysql -uroot -h127.0.0.1 cm_e2e
cd server
DATABASE_URL="mysql://root@127.0.0.1:3306/cm_e2e" JWT_SECRET=e2e-test-secret npx tsx src/scripts/migrate.ts
DATABASE_URL="mysql://root@127.0.0.1:3306/cm_e2e" JWT_SECRET=e2e-test-secret ADMIN_USERNAME=e2eadmin ADMIN_PASSWORD=E2e-Admin-123 npx tsx src/scripts/create-admin.ts
```

To use another database, set `E2E_DATABASE_URL` before running the tests.

## Running

The tests start their own API (port 4100) and client (port 5180), so `npm run dev` can keep running.

| Command | What it does |
| --- | --- |
| `npm run test:e2e` | Runs every test headless, desktop and phone |
| `npm run test:e2e -- --project=desktop` | Desktop only |
| `npm run test:e2e:ui` | Opens Playwright's UI: watch each step, re-run, inspect |
| `npx playwright test --headed` | Shows the real browser while it runs |
| `npx playwright show-report` | Opens the last report (screenshots and traces of failures) |
| `npx playwright codegen http://localhost:5173` (with `npm run dev` running) | Click through the app and Playwright writes the test code |

## Writing tests

- Put tests in `e2e/*.spec.ts` and import `test`, `expect` and `signIn` from `./helpers` (not from `@playwright/test`). Its `test` fails any test that reaches the dev API on port 4000, which uses the main database. `signIn(page)` logs in as the test admin.
- Prefer locators people would use: `getByRole("button", { name: "Export" })`, `getByLabel("Username")`, `getByPlaceholder(...)`.
- Open pages with `page.goto("/loans")` rather than the menu, so tests work in the phone layout too.
- After typing in a search box, wait for the results (e.g. `Showing 1-1 of 1`) before hovering or clicking rows; the list re-renders when they arrive.
- Lists are rendered twice (phone cards and desktop table, one hidden), so add `.filter({ visible: true })` when looking for a row's text.
- `e2e/data.ts` creates test data through the API (`seedBranch`, `importLoans`, `addActionTaken`, `createAccount`). Names carry a unique tag, so search by it.
- To run tests while the UI mode window is open, give them other ports: `E2E_API_PORT=4200 E2E_CLIENT_PORT=5280 npm run test:e2e`.
