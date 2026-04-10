# Vercel Deployment

This project deploys to Vercel as:

- Vite React frontend from `client/dist`
- Express API mounted through `api/index.ts` and `api/[...path].ts`
- Supabase Postgres connection through `DATABASE_URL`

## Required Environment Variables

Set these in the Vercel project settings:

```text
DATABASE_URL=postgresql://...
JWT_SECRET=replace-with-a-long-random-secret
API_BODY_LIMIT=25mb
```

The client defaults to calling the same deployment at `/api` in production. Only set `VITE_API_BASE_URL` in Vercel if the API is deployed on a different domain. Do not set it to `localhost` in Vercel.

Do not prefix secrets with `VITE_`. Vite exposes `VITE_` variables to the browser bundle, so database credentials, service-role keys, JWT secrets, private API keys, and webhook secrets must stay server-side.

For Supabase, use a connection string that works from hosted serverless functions. The Supabase pooler connection string is usually safer than opening many direct Postgres connections.

## Build Settings

Vercel can read these from `vercel.json`:

```text
Root Directory: ./
Install Command: npm install
Build Command: npm run vercel-build
Output Directory: dist
```

Do not set the Vercel root directory to `client`. The API functions live in the repository-level `api/` directory, so deploying from `client` only will build the frontend without the Express API.

## Deploy Checklist

1. Push the repository to GitHub, GitLab, or Bitbucket.
2. Import the repository in Vercel.
3. Add the required environment variables.
4. Deploy.
5. Visit `/api/health` on the deployed domain to confirm the API is responding.
