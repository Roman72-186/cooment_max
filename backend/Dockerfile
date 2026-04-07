# Build context = корень проекта (задаётся в docker-compose.yml)
FROM node:20-alpine AS builder

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install

COPY backend/tsconfig.json ./
COPY backend/src/ ./src/

WORKDIR /app
COPY shared/ ./shared/

WORKDIR /app/backend
RUN npm run build

# ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/backend/dist ./dist

USER node

CMD ["node", "dist/backend/src/index.js"]
