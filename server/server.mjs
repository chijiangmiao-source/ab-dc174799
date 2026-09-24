/**
 * 极简静态站点服务（纯 Node.js，无第三方依赖）：
 *  - GET /healthz → 200 {"status":"ok"}
 *  - 其余路径返回 dist/ 静态资源，未知路径回退 index.html（单页应用）
 * 监听端口取环境变量 PORT（Compose 注入，默认 8080）。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2'
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/healthz') {
    send(res, 200, JSON.stringify({ status: 'ok' }), 'application/json; charset=utf-8');
    return;
  }
  let path = decodeURIComponent(url.pathname);
  if (path === '/') path = '/index.html';
  const filePath = normalize(join(DIST, path));
  if (!filePath.startsWith(DIST)) {
    send(res, 403, 'forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    send(res, 200, data, MIME[extname(filePath)] || 'application/octet-stream');
  } catch {
    // 单页应用回退
    try {
      const index = await readFile(join(DIST, 'index.html'));
      send(res, 200, index, MIME['.html']);
    } catch {
      send(res, 503, '站点尚未构建：请先运行 npm run build');
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`qec-chain-review listening on :${PORT}`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
