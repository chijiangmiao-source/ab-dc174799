/*
 * 一次性验收服务（Compose 中的 verify 服务入口）：
 *   1. 先在“局部最近边界并非全局最优”的格图中确认选择事件对而非两条边界链；
 *   2. 穿插完成匹配代码测试（开花算法 vs 暴力枚举）；
 *   3. 构建检查（JS 语法、必需文件、页面资源引用、Compose 配置要点）；
 *   4. HTTP 冒烟（/healthz、首页、Worker 与算法脚本、404）。
 * 执行后退出并以退出码报告结果：全部通过为 0，否则为 1。
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = __dirname;
let failures = 0;

function ok(name, detail) {
  console.log('  [PASS] ' + name + (detail ? ' — ' + detail : ''));
}

function fail(name, err) {
  failures++;
  console.error('  [FAIL] ' + name + '\n         ' + String((err && err.message) || err));
}

function step(title, fn) {
  console.log('\n== ' + title + ' ==');
  try {
    const info = fn();
    ok(title, info);
  } catch (err) {
    fail(title, err);
  }
}

async function stepAsync(title, fn) {
  console.log('\n== ' + title + ' ==');
  try {
    const info = await fn();
    ok(title, info);
  } catch (err) {
    fail(title, err);
  }
}

/* ---------- 1. 验收场景 ---------- */
function acceptanceScenario() {
  const scenario = require('./test/scenario.test');
  const info = scenario.run();
  return '机械连边界总代价 ' + info.greedy + '，求解器选择事件配对总代价 ' + info.optimal;
}

/* ---------- 2. 匹配代码测试 ---------- */
function matchingTests() {
  const matching = require('./test/matching.test');
  const info = matching.run();
  return '固定用例 + 3000 组随机对拍（可行 ' + info.randomizedFeasible + ' 组）+ 400 组归约形状对拍';
}

function solverTests() {
  const solver = require('./test/solver.test');
  const info = solver.run();
  const worker = require('./test/worker.test');
  worker.run();
  return '校验定位 + ' + info.endToEnd + ' 组端到端对拍（代价与规范向量均一致）+ Worker 协议';
}

/* ---------- 3. 构建检查 ---------- */
function buildChecks() {
  const jsFiles = [
    'server.js',
    'verify.js',
    'src/matching.js',
    'src/solver.js',
    'src/worker.js',
    'public/app.js',
    'test/brute.js',
    'test/matching.test.js',
    'test/solver.test.js',
    'test/scenario.test.js',
    'test/worker.test.js',
    'test/run.js',
  ];
  for (const f of jsFiles) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) throw new Error('缺少文件 ' + f);
    execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
  }
  const mustExist = [
    'public/index.html',
    'public/style.css',
    'Dockerfile',
    'docker-compose.yml',
    'package.json',
  ];
  for (const f of mustExist) {
    if (!fs.existsSync(path.join(ROOT, f))) throw new Error('缺少文件 ' + f);
  }
  // 首页引用的资源必须存在
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const refs = [];
  for (const m of html.matchAll(/(?:src|href)="(\/[^"]*)"/g)) refs.push(m[1]);
  for (const ref of refs) {
    const rel = ref.startsWith('/src/') ? ref.slice(1) : path.join('public', ref);
    if (!fs.existsSync(path.join(ROOT, rel))) {
      throw new Error('首页引用的资源不存在：' + ref);
    }
  }
  // Compose 配置要点：可配置端口、/healthz、verify 服务
  const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
  for (const needle of ['WEB_PORT', '/healthz', 'verify:', 'web:']) {
    if (!compose.includes(needle)) throw new Error('docker-compose.yml 缺少要点：' + needle);
  }
  return jsFiles.length + ' 个 JS 文件语法通过，' + refs.length + ' 个页面资源引用完整';
}

/* ---------- 4. HTTP 冒烟 ---------- */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('请求超时：' + url));
    });
  });
}

async function waitHealthy(base, attempts) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await httpGet(base + '/healthz');
      if (r.status === 200) return;
    } catch (e) {
      /* 继续等待 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('服务未在预期时间内就绪：' + base);
}

async function httpSmoke() {
  let base = process.env.WEB_URL;
  let child = null;
  if (!base) {
    // 本地模式：自行拉起一个临时服务器
    const { spawn } = require('child_process');
    const port = 18080 + Math.floor(Math.random() * 1000);
    child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      env: Object.assign({}, process.env, { PORT: String(port) }),
      stdio: 'ignore',
    });
    base = 'http://127.0.0.1:' + port;
  }
  try {
    await waitHealthy(base, 40);
    const health = await httpGet(base + '/healthz');
    if (health.status !== 200) throw new Error('/healthz 返回 ' + health.status);
    const parsed = JSON.parse(health.body);
    if (parsed.status !== 'ok') throw new Error('/healthz 内容异常：' + health.body);

    const home = await httpGet(base + '/');
    if (home.status !== 200 || !home.body.includes('纠错链复核台')) {
      throw new Error('首页异常：status=' + home.status);
    }
    for (const asset of ['/src/worker.js', '/src/matching.js', '/src/solver.js', '/app.js', '/style.css']) {
      const r = await httpGet(base + asset);
      if (r.status !== 200) throw new Error(asset + ' 返回 ' + r.status);
    }
    const missing = await httpGet(base + '/no-such-page');
    if (missing.status !== 404) throw new Error('未知路径应返回 404，实际 ' + missing.status);
    const traversal = await httpGet(base + '/src/../package.json');
    if (traversal.status === 200 && traversal.body.includes('"scripts"')) {
      throw new Error('目录穿越防护失效');
    }
    return base + ' 健康检查、首页、脚本资源、404 与穿越防护均正常';
  } finally {
    if (child) child.kill();
  }
}

/* ---------- 主流程 ---------- */
(async function main() {
  console.log('verify: 一次性验收开始');
  step('1/4 验收场景：局部最近边界并非全局最优 → 选择事件配对链', acceptanceScenario);
  step('2/4 匹配代码测试（开花算法 vs 暴力枚举）', matchingTests);
  step('2/4 求解器测试（校验定位 + 端到端对拍 + 规范化）', solverTests);
  step('3/4 构建检查', buildChecks);
  await stepAsync('4/4 HTTP 冒烟', httpSmoke);

  console.log('');
  if (failures) {
    console.error('verify: 失败（' + failures + ' 项未通过）');
    process.exit(1);
  }
  console.log('verify: 全部通过');
  process.exit(0);
})();
