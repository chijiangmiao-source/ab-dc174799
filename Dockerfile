FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

# 无第三方依赖，直接拷贝源码
COPY package.json server.js verify.js ./
COPY src ./src
COPY public ./public
COPY test ./test

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
