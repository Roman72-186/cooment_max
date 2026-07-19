# Build context = корень проекта (задаётся в docker-compose.yml)
# Структура в контейнере зеркалит локальную: /app/bot/ и /app/shared/
# Это нужно чтобы TypeScript находил импорты ../../../shared/types.js

FROM node:20-alpine AS builder

# Устанавливаем зависимости в bot/
WORKDIR /app/bot
COPY bot/package*.json ./
RUN npm install

# Копируем исходники бота
COPY bot/tsconfig.json ./
COPY bot/src/ ./src/

# shared/ кладём уровнем выше — как в локальном проекте
WORKDIR /app
COPY shared/ ./shared/

# Собираем TypeScript из папки bot/
WORKDIR /app/bot
RUN npm run build

# ─────────────────────────────────────────────────────────────────
# Production: только скомпилированный JS, shared не нужен (все импорты типов стираются)
FROM node:20-alpine AS production

WORKDIR /app/bot

COPY bot/package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/bot/dist ./dist

# Сертификат НУЦ Минцифры — без него исходящие HTTPS-запросы к platform-api2.max.ru
# (домен MAX API с 19.07.2026) падают по TLS. apk/update-ca-certificates на хосте
# сюда не доходит — доверие нужно внутри самого образа.
COPY infra/certs/russian_trusted_ca_bundle.pem /app/certs/russian_trusted_ca_bundle.pem
ENV NODE_EXTRA_CA_CERTS=/app/certs/russian_trusted_ca_bundle.pem

USER node

CMD ["node", "dist/bot/src/index.js"]
