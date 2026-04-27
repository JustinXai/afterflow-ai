FROM node:20-alpine
RUN apk add --no-cache openssl libc6-compat

EXPOSE 3000
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV SHOPIFY_APP_URL=https://afterflow-ai-production.up.railway.app
ENV GEMINI_API_KEY=""
ENV SHOPIFY_API_KEY=""
ENV SHOPIFY_API_SECRET=""
ENV SCOPES="read_orders,write_orders"

# 1. 复制依赖描述文件
COPY package.json package-lock.json* ./

# 2. 安装全部依赖 (包含 devDependencies，因为 build 需要它们)
RUN npm install

# 3. 复制所有代码
COPY . .

# 4. 生成 Prisma 客户端 (关键步骤！)
RUN npx prisma generate

# 5. 构建项目
RUN npm run build

# 6. 清理开发依赖，减小镜像体积
RUN npm prune --production

# 7. 启动脚本：先跑数据库迁移，再启动
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]