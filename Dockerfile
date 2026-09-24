# syntax=docker/dockerfile:1

# ---------- 依赖与构建 ----------
FROM node:20-bookworm-slim AS build
WORKDIR /app
# 先拷贝依赖清单以利用层缓存
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# 类型检查 + 构建（verify 阶段复用其产物与 node_modules）
RUN npx tsc --noEmit && npx vite build

# ---------- web：仅托管 dist 静态产物（无第三方运行时依赖） ----------
FROM node:20-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
EXPOSE 8080
# 容器内健康检查（Compose 的 service_healthy 依赖它）
HEALTHCHECK --interval=5s --timeout=3s --retries=10 --start-period=2s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/server.mjs"]

# ---------- verify：一次性验收（关键场景 + 匹配测试 + 构建 + HTTP 冒烟） ----------
FROM build AS verify
WORKDIR /app
# 默认对 Compose 中的 web 服务做 HTTP 冒烟；入口由 compose 命令给出
CMD ["node", "scripts/verify.mjs", "--web-url", "http://web:8080"]
