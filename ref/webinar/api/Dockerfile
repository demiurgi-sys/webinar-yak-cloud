# --- Build stage ---
FROM node:20-alpine AS build
WORKDIR /app

# Встановлюємо залежності (тільки production)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Копіюємо код
COPY src ./src

# --- Runtime stage ---
FROM node:20-alpine
WORKDIR /app

# Створюємо непривілейованого користувача
RUN addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/src ./src
COPY --chown=app:app package.json ./

ENV NODE_ENV=production
ENV PORT=4000

USER app
EXPOSE 4000

CMD ["node", "src/index.js"]
