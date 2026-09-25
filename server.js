/*
 * 静态资源服务器 + /healthz 健康检查。
 * 端口由环境变量 PORT 控制（默认 8080）。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// URL 路径 -> 磁盘目录（防目录穿越）
const MOUNTS = [
  { prefix: '/src/', dir: path.join(ROOT, 'src') },
  { prefix: '/', dir: path.join(ROOT, 'public') },
];

function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  for (const mount of MOUNTS) {
    if (!clean.startsWith(mount.prefix)) continue;
    const rel = clean.slice(mount.prefix.length);
    const file = path.normalize(path.join(mount.dir, rel));
    if (!file.startsWith(mount.dir)) return null; // 穿越防护
    return file;
  }
  return null;
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  let file;
  if (url === '/' || url === '/index.html') {
    file = path.join(ROOT, 'public', 'index.html');
  } else {
    file = resolveFile(url);
  }

  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, {
        'Content-Type': 'text/plain; charset=utf-8',
      });
      res.end(err.code === 'ENOENT' ? 'not found' : 'internal error');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('qec-chain-review listening on port ' + PORT);
});
