# ─── Build stage ───────────────────────────────────────────────────────────────
# NOTE: Railway auto-rebuilds from this Dockerfile via GitHub Sync
FROM node:20-alpine AS builder
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# ─── Production stage ───────────────────────────────────────────────────────────
FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/build ./build
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.js ./

# Create index.html from demo.html at container startup
RUN cp public/demo.html public/index.html || true

# Run migrations on startup, then start server
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
