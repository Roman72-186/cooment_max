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

# Сертификат НУЦ Минцифры — без него исходящие HTTPS-запросы к platform-api2.max.ru
# (домен MAX API с 19.07.2026) падают по TLS. apk/update-ca-certificates на хосте
# сюда не доходит — доверие нужно внутри самого образа.
COPY infra/certs/russian_trusted_ca_bundle.pem /app/certs/russian_trusted_ca_bundle.pem
ENV NODE_EXTRA_CA_CERTS=/app/certs/russian_trusted_ca_bundle.pem

USER node

CMD ["node", "dist/backend/src/index.js"]
