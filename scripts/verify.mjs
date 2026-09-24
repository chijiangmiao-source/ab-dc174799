#!/usr/bin/env node
/**
 * verify —— 一次性验收服务（执行后退出，以退出码报告结果）。
 *
 * 顺序（关键场景最先，其余穿插其后）：
 *   1) 在“局部最近边界并非全局最优”格图中，断言求解器选择事件对而非两条边界链；
 *   2) 匹配代码测试（Vitest：Blossom 与求解管线全部用例）；
 *   3) 构建检查（tsc 类型检查 + Vite 构建）；
 *   4) HTTP 冒烟（/healthz 与首页）：
 *        - 传入 --web-url 时（Compose 下）探测真实 web 服务；
 *        - 否则本地拉起 dist 静态服务器自测。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = new URL('..', import.meta.url).pathname;
const BIN = process.platform === 'win32' ? 'node_modules\\.bin' : 'node_modules/.bin';
const args = process.argv.slice(2);
const webUrlArg = (() => {
  const i = args.indexOf('--web-url');
  return i !== -1 ? args[i + 1] : null;
})();

let failures = 0;

function heading(t) {
  console.log(`\n════════ ${t} ${'═'.repeat(Math.max(0, 60 - t.length))}`);
}

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...opts.env }
  });
  return r.status === 0;
}

async function http(url, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

// 1) 关键场景：必须最先完成
heading('1/4 关键场景：局部最近边界并非全局最优 → 选择事件对');
{
  const ok = run('node', [`${BIN}${process.platform === 'win32' ? '\\' : '/'}vite-node`, 'scripts/verify-case.ts']);
  if (!ok) {
    failures++;
    console.error('关键场景断言失败，终止验收。');
    process.exit(1);
  }
}

// 2) 匹配代码测试（含 Blossom 暴力对照与求解管线随机格网对照）
heading('2/4 匹配代码测试（Vitest）');
{
  const exe = process.platform === 'win32' ? `${BIN}\\vitest.cmd` : `${BIN}/vitest`;
  const ok = run(exe, ['run', '--reporter=dot']);
  if (!ok) {
    failures++;
    console.error('匹配代码测试未通过。');
  }
}

// 3) 构建检查：类型检查 + Vite 构建
heading('3/4 构建检查（tsc --noEmit + vite build）');
{
  const tscOk = run('node', [`${BIN}/tsc`, '--noEmit']);
  const buildOk = run('node', [`${BIN}/vite`, 'build']);
  const ok = tscOk && buildOk && existsSync(`${ROOT}dist/index.html`);
  if (!ok) {
    failures++;
    console.error('构建失败（类型检查/打包/产物缺失）。');
  }
}

// 4) HTTP 冒烟
heading('4/4 HTTP 冒烟（/healthz 与首页）');
{
  let base = webUrlArg;
  let spawned = null;
  if (!base) {
    const port = String(8100 + Math.floor(Math.random() * 800));
    base = `http://127.0.0.1:${port}`;
    spawned = spawn('node', ['server/server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: port }, stdio: 'ignore' });
  }
  let health = 0;
  let index = 0;
  for (let i = 0; i < 30; i++) {
    health = await http(`${base}/healthz`);
    index = await http(`${base}/`);
    if (health === 200 && index === 200) break;
    await sleep(500);
  }
  const healthBody = health === 200 ? await (await fetch(`${base}/healthz`)).json() : null;
  console.log(`  GET /healthz → ${health}${healthBody ? ' ' + JSON.stringify(healthBody) : ''}`);
  console.log(`  GET /        → ${index}`);
  if (!(health === 200 && healthBody && healthBody.status === 'ok' && index === 200)) {
    failures++;
    console.error('HTTP 冒烟未通过。');
  }
  if (spawned) spawned.kill('SIGTERM');
}

heading('验收结论');
if (failures === 0) {
  console.log('✅ verify 全部通过：关键场景、匹配测试、构建、HTTP 冒烟均成功。');
  process.exit(0);
} else {
  console.error(`❌ verify 存在 ${failures} 个失败阶段。`);
  process.exit(1);
}
