# Single-stage build: install deps + build + serve in one image
FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build
RUN npm prune --production

# Serve demo.html at root
RUN cp public/demo.html public/index.html || true

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
