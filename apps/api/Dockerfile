FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM dependencies AS builder
COPY prisma.config.ts prisma.config.ts
COPY apps/api apps/api
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build --workspace=@price-tracker/api

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace=@price-tracker/api && npm cache clean --force
COPY --from=builder /app/apps/api/dist /app/apps/api/dist
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/http/read-api.main.js"]
