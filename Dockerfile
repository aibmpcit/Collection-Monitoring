# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json

RUN npm ci

COPY client/ ./client/
COPY server/ ./server/

ENV VITE_API_BASE_URL=/api

RUN npm run build


FROM node:24-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production PORT=4000 SERVE_CLIENT=true

COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json

RUN npm ci --omit=dev --workspace server --include-workspace-root=false \
    && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

# Database schema
COPY database/schema.mysql.sql ./schema.mysql.sql

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "node server/dist/scripts/migrate.js && node server/dist/index.js"]
