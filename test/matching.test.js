/*
 * 开花匹配代码测试：固定用例 + 与暴力枚举的随机化对拍。
 * 通过 require 在 Node 中运行；verify 服务与 npm test 均调用 run()。
 */
'use strict';

const Matching = require('../src/matching.js');
const { bruteMinPerfectMatching } = require('./brute');

function assert(cond, msg) {
  if (!cond) throw new Error('matching test failed: ' + msg);
}

// 确定性伪随机数（可复现）
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function checkAgainstBrute(n, edges, label) {
  const got = Matching.minWeightPerfectMatching(n, edges);
  const want = bruteMinPerfectMatching(n, edges);
  if (want === null) {
    assert(got === null, label + ': expected infeasible, got ' + JSON.stringify(got));
    return;
  }
  assert(got !== null, label + ': expected cost ' + want + ', got infeasible');
  assert(
    got.cost === want,
    label + ': cost mismatch got ' + got.cost + ' want ' + want + ' edges=' + JSON.stringify(edges)
  );
  // 校验返回的配对确实合法且代价吻合
  const seen = new Set();
  let sum = 0;
  const wmap = new Map();
  for (const e of edges) {
    const k = e[0] < e[1] ? e[0] + ',' + e[1] : e[1] + ',' + e[0];
    if (!wmap.has(k) || e[2] < wmap.get(k)) wmap.set(k, e[2]);
  }
  for (const p of got.pairs) {
    assert(!seen.has(p[0]) && !seen.has(p[1]), label + ': overlapping pairs');
    seen.add(p[0]);
    seen.add(p[1]);
    const k = p[0] < p[1] ? p[0] + ',' + p[1] : p[1] + ',' + p[0];
    assert(wmap.has(k), label + ': pair uses non-edge ' + k);
    sum += wmap.get(k);
  }
  assert(seen.size === n, label + ': matching not perfect');
  assert(sum === got.cost, label + ': reported cost does not match pairs');
}

function runFixedCases() {
  // 空图
  assert(Matching.minWeightPerfectMatching(0, []).cost === 0, 'empty graph');
  // 奇数顶点
  assert(Matching.minWeightPerfectMatching(3, [[0, 1, 1]]) === null, 'odd vertex count');
  // 单边
  assert(Matching.minWeightPerfectMatching(2, [[0, 1, 7]]).cost === 7, 'single edge');
  // 三角形加悬挂（需要开花收缩的经典形状）
  checkAgainstBrute(
    6,
    [
      [0, 1, 1],
      [1, 2, 1],
      [2, 0, 1],
      [0, 3, 1],
      [1, 4, 9],
      [2, 5, 9],
      [3, 4, 1],
      [4, 5, 1],
    ],
    'fixed flower'
  );
  // 不可行：星形图无完美匹配
  assert(
    Matching.minWeightPerfectMatching(4, [
      [0, 1, 1],
      [0, 2, 1],
      [0, 3, 1],
    ]) === null,
    'star infeasible'
  );
  // 零权边（对应归约中的虚拟边界节点）
  checkAgainstBrute(
    4,
    [
      [0, 1, 5],
      [2, 3, 0],
      [0, 2, 0],
      [1, 3, 0],
    ],
    'zero weights'
  );
  // 完全图 K4 已知最优
  const k4 = Matching.minWeightPerfectMatching(4, [
    [0, 1, 1],
    [0, 2, 9],
    [0, 3, 9],
    [1, 2, 9],
    [1, 3, 9],
    [2, 3, 1],
  ]);
  assert(k4.cost === 2, 'K4 expected cost 2, got ' + k4.cost);
}

function runRandomized(iterations) {
  const rng = makeRng(20260925);
  let feasible = 0;
  for (let t = 0; t < iterations; t++) {
    const pairs = 2 + Math.floor(rng() * 5); // 2..6 对 → 4..12 顶点
    const n = pairs * 2;
    const p = [0.35, 0.6, 1.0][t % 3];
    const maxW = [1, 5, 20, 100][t % 4];
    const allowZero = t % 5 === 0;
    const edges = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (rng() > p) continue;
        const lo = allowZero ? 0 : 1;
        edges.push([i, j, lo + Math.floor(rng() * (maxW - lo + 1))]);
      }
    }
    checkAgainstBrute(n, edges, 'random#' + t + ' n=' + n + ' p=' + p);
    if (bruteMinPerfectMatching(n, edges) !== null) feasible++;
  }
  return feasible;
}

function run() {
  runFixedCases();
  const feasible = runRandomized(3000);
  // 归约形状专项：n 事件 + n 虚拟节点（虚拟节点间零权完全图）
  const rng = makeRng(777);
  for (let t = 0; t < 400; t++) {
    const nEv = 1 + Math.floor(rng() * 5); // 1..5 个事件
    const n = nEv * 2;
    const edges = [];
    for (let i = 0; i < nEv; i++) {
      for (let j = i + 1; j < nEv; j++) {
        edges.push([i, j, 1 + Math.floor(rng() * 30)]);
      }
    }
    for (let i = 0; i < nEv; i++) {
      if (rng() < 0.8) edges.push([i, nEv + i, 1 + Math.floor(rng() * 30)]);
    }
    for (let i = 0; i < nEv; i++) {
      for (let j = i + 1; j < nEv; j++) edges.push([nEv + i, nEv + j, 0]);
    }
    checkAgainstBrute(n, edges, 'reduction#' + t);
  }
  return { randomizedFeasible: feasible };
}

module.exports = { run };

if (require.main === module) {
  const info = run();
  console.log('matching tests passed', info);
}
