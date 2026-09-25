/*
 * Worker 协议测试：在 vm 中模拟 Web Worker 全局环境（self === globalThis），
 * 加载 src/worker.js 并验证求解消息往返。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error('worker test failed: ' + msg);
}

function createWorker() {
  const sandbox = { console };
  const ctx = vm.createContext(sandbox);
  const g = vm.runInContext('globalThis', ctx);
  g.self = g; // 真实 Worker 中 self 即全局对象
  g.importScripts = (...files) => {
    for (const f of files) {
      const code = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
      vm.runInContext(code, ctx, { filename: f });
    }
  };
  const posted = [];
  g.postMessage = (msg) => posted.push(msg);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'worker.js'), 'utf8'), ctx, {
    filename: 'worker.js',
  });
  return {
    send(data) {
      g.self.onmessage({ data });
      return posted.shift();
    },
  };
}

function run() {
  const worker = createWorker();
  const res = worker.send({
    type: 'solve',
    runId: 7,
    spec: {
      rows: 1,
      cols: 6,
      hCosts: [[1, 1, 1, 1, 1]],
      vCosts: [],
      boundaries: [
        [0, 0],
        [0, 5],
      ],
      events: [
        [0, 1],
        [0, 2],
      ],
    },
  });
  assert(res && res.runId === 7, 'runId echoed');
  assert(res.ok === true, 'solve ok: ' + JSON.stringify(res));
  assert(res.totalCost === 1 && res.chains.length === 1 && res.chains[0].type === 'pair', 'pair chain chosen');

  // 校验错误经 Worker 返回
  const bad = worker.send({
    type: 'solve',
    runId: 8,
    spec: {
      rows: 2,
      cols: 2,
      hCosts: [[0], [1]],
      vCosts: [[1, 1]],
      boundaries: [],
      events: [
        [0, 0],
        [0, 0],
      ],
    },
  });
  assert(bad.ok === false, 'invalid spec rejected');
  assert(bad.errors.some((e) => e.code === 'edge-cost'), 'edge-cost reported');
  assert(bad.errors.some((e) => e.code === 'event-dup'), 'event-dup reported');

  // 未知消息类型被忽略
  const w2 = createWorker();
  const none = w2.send({ type: 'noop', runId: 1 });
  assert(none === undefined, 'unknown message ignored');
}

module.exports = { run };

if (require.main === module) {
  run();
  console.log('worker tests passed');
}
