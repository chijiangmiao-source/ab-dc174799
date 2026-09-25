/*
 * 求解器测试：校验错误定位、端到端对拍（枚举事件配对/边界指派）、
 * 规范化（同成本链向量字典序：边界优先、另一端标识升序）。
 */
'use strict';

const Solver = require('../src/solver.js');
const Matching = require('../src/matching.js');

function assert(cond, msg) {
  if (!cond) throw new Error('solver test failed: ' + msg);
}

function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function fullSpec(partial) {
  const rows = partial.rows, cols = partial.cols;
  const hCosts = [];
  for (let r = 0; r < rows; r++) hCosts.push(new Array(Math.max(0, cols - 1)).fill(1));
  const vCosts = [];
  for (let r = 0; r < rows - 1; r++) vCosts.push(new Array(cols).fill(1));
  return Object.assign({ hCosts, vCosts, boundaries: [], events: [] }, partial);
}

/* ---------- 校验错误 ---------- */
function testValidation() {
  // 重复事件
  let errs = Solver.validate(fullSpec({ rows: 3, cols: 3, events: [[1, 1], [2, 2], [1, 1]] }));
  assert(errs.some((e) => e.code === 'event-dup' && e.at.cell[0] === 1 && e.at.cell[1] === 1), 'event-dup located');
  // 越界边界
  errs = Solver.validate(fullSpec({ rows: 3, cols: 3, boundaries: [[3, 0]], events: [[0, 0], [1, 1]] }));
  assert(errs.some((e) => e.code === 'boundary-range' && e.at.boundary === 0), 'boundary-range located');
  // 非正边代价
  const spec = fullSpec({ rows: 2, cols: 2, events: [[0, 0], [1, 1]] });
  spec.hCosts[0][0] = 0;
  spec.vCosts[0][1] = -4;
  errs = Solver.validate(spec);
  assert(errs.filter((e) => e.code === 'edge-cost').length === 2, 'edge-cost located');
  assert(errs[0].at.edge, 'edge-cost has edge location');
  // 非整数边代价
  const spec2 = fullSpec({ rows: 2, cols: 2, events: [[0, 0], [1, 1]] });
  spec2.hCosts[1][0] = 1.5;
  assert(Solver.validate(spec2).some((e) => e.code === 'edge-cost'), 'non-integer edge cost');
  // 无可达终点：奇数事件且无边界
  errs = Solver.validate(fullSpec({ rows: 2, cols: 3, events: [[0, 0], [0, 1], [1, 0]] }));
  assert(errs.some((e) => e.code === 'unreachable' && e.at.events.length === 3), 'unreachable located');
  // 事件数量越界
  assert(
    Solver.validate(fullSpec({ rows: 2, cols: 2, events: [[0, 0]] })).some((e) => e.code === 'event-count'),
    'too few events'
  );
  const many = [];
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) many.push([r, c]);
  assert(
    Solver.validate(fullSpec({ rows: 7, cols: 7, boundaries: [[0, 0]], events: many })).some(
      (e) => e.code === 'event-count'
    ),
    'too many events'
  );
  // 事件越界
  errs = Solver.validate(fullSpec({ rows: 2, cols: 2, events: [[0, 0], [5, 5]] }));
  assert(errs.some((e) => e.code === 'event-range' && e.at.event === 1), 'event-range located');
  // 合法规格无错误
  errs = Solver.validate(
    fullSpec({ rows: 3, cols: 3, boundaries: [[0, 0]], events: [[0, 1], [1, 1], [2, 2]] })
  );
  assert(errs.length === 0, 'valid spec has no errors, got ' + JSON.stringify(errs));
}

/* ---------- 暴力基准：枚举事件配对 + 边界指派 ---------- */
function bruteSolve(spec) {
  const rows = spec.rows, cols = spec.cols;
  const events = spec.events;
  const boundaries = [];
  const bs = new Set();
  for (const b of spec.boundaries || []) {
    const k = b[0] + ',' + b[1];
    if (!bs.has(k)) { bs.add(k); boundaries.push(b); }
  }
  const n = events.length;
  const cellOf = (c) => c[0] * cols + c[1];
  const adj = Solver.buildAdj(spec);
  const dists = events.map((e) => Solver.dijkstra(rows * cols, adj, cellOf(e)).dist);
  const evB = events.map((e, i) => {
    let best = Infinity, bid = -1;
    for (let b = 0; b < boundaries.length; b++) {
      const d = dists[i][cellOf(boundaries[b])];
      if (d < best) { best = d; bid = b; }
    }
    return { dist: best, bid };
  });
  // 递归枚举：每个事件要么与另一未配事件配对，要么连边界
  let bestCost = Infinity;
  let bestVec = null;
  const used = new Array(n).fill(false);
  function descriptorCost() {
    // 计算当前指派的总代价与规范向量
  }
  const assign = new Array(n).fill(null); // 'B' 或 对方下标
  function rec() {
    let i = 0;
    while (i < n && used[i]) i++;
    if (i === n) {
      let cost = 0;
      const vec = [];
      for (let k = 0; k < n; k++) {
        if (assign[k] === 'B') {
          cost += evB[k].dist;
          vec.push([0, evB[k].bid]);
        } else if (assign[k] > k) {
          cost += dists[k][cellOf(events[assign[k]])];
          vec.push([1, assign[k]]);
        } else {
          vec.push([1, assign[k]]);
        }
      }
      if (cost < bestCost || (cost === bestCost && vecLess(vec, bestVec))) {
        bestCost = cost;
        bestVec = vec;
      }
      return;
    }
    used[i] = true;
    // 连边界
    if (evB[i].bid >= 0 && evB[i].dist !== Infinity) {
      assign[i] = 'B';
      rec();
    }
    // 配对
    for (let j = i + 1; j < n; j++) {
      if (used[j]) continue;
      if (dists[i][cellOf(events[j])] === Infinity) continue;
      used[j] = true;
      assign[i] = j;
      assign[j] = i;
      rec();
      used[j] = false;
    }
    assign[i] = null;
    used[i] = false;
  }
  function vecLess(a, b) {
    if (b === null) return true;
    for (let k = 0; k < a.length; k++) {
      if (a[k][0] !== b[k][0]) return a[k][0] < b[k][0];
      if (a[k][1] !== b[k][1]) return a[k][1] < b[k][1];
    }
    return false;
  }
  rec();
  return bestCost === Infinity ? null : { cost: bestCost, vec: bestVec };
}

function solverVector(res) {
  // 从求解结果构造与暴力端一致的规范向量
  const vec = [];
  for (let i = 0; i < res.events.length; i++) {
    const ch = res.chains[res.assignments[i].chain];
    if (ch.type === 'boundary') vec.push([0, ch.boundary]);
    else vec.push([1, ch.events[0] === i ? ch.events[1] : ch.events[0]]);
  }
  return vec;
}

function testEndToEnd() {
  const rng = makeRng(1357);
  let checked = 0;
  for (let t = 0; t < 400; t++) {
    const rows = 2 + Math.floor(rng() * 3); // 2..4
    const cols = 2 + Math.floor(rng() * 3);
    const hCosts = [];
    for (let r = 0; r < rows; r++) {
      hCosts.push([]);
      for (let c = 0; c < cols - 1; c++) hCosts[r].push(1 + Math.floor(rng() * 4));
    }
    const vCosts = [];
    for (let r = 0; r < rows - 1; r++) {
      vCosts.push([]);
      for (let c = 0; c < cols; c++) vCosts[r].push(1 + Math.floor(rng() * 4));
    }
    const cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([r, c]);
    // 随机打乱取事件与边界
    for (let k = cells.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      const tmp = cells[k]; cells[k] = cells[j]; cells[j] = tmp;
    }
    const nEv = 2 + Math.floor(rng() * Math.min(4, cells.length - 1));
    const events = cells.slice(0, nEv);
    const boundaries = rng() < 0.25 ? [] : cells.slice(nEv, nEv + 1 + Math.floor(rng() * 2));
    if (boundaries.length === 0 && nEv % 2 === 1) continue; // 不可行情形由专项测试覆盖
    const spec = { rows, cols, hCosts, vCosts, boundaries, events };
    const res = Solver.solve(spec);
    assert(res.ok, 'solve ok on random spec ' + t + ': ' + JSON.stringify(res.errors));
    const brute = bruteSolve(spec);
    assert(brute !== null, 'brute feasible ' + t);
    assert(
      res.totalCost === brute.cost,
      'cost mismatch t=' + t + ' got ' + res.totalCost + ' want ' + brute.cost +
        ' spec=' + JSON.stringify(spec)
    );
    const vec = solverVector(res);
    assert(
      JSON.stringify(vec) === JSON.stringify(brute.vec),
      'canonical vector mismatch t=' + t + '\n got ' + JSON.stringify(vec) +
        '\nwant ' + JSON.stringify(brute.vec) + '\nspec=' + JSON.stringify(spec)
    );
    checked++;
  }
  return checked;
}

/* ---------- 规范化专项 ---------- */
function testCanonical() {
  // 同成本：边界优先。1×3，边界 (0,0) 与 (0,2)，事件 (0,1)、(0,2)
  // E1→边界=1、E2→边界=0 合计 1；E1—E2 配对=1。同价，应选两条边界链。
  let res = Solver.solve(
    fullSpec({ rows: 1, cols: 3, boundaries: [[0, 0], [0, 2]], events: [[0, 1], [0, 2]] })
  );
  assert(res.ok, 'canonical boundary-pref solves');
  assert(res.totalCost === 1, 'canonical boundary-pref cost');
  assert(res.chains.length === 2 && res.chains.every((c) => c.type === 'boundary'),
    'boundary preferred over pair on tie, got ' + JSON.stringify(res.chains.map((c) => c.type)));

  // 同成本：另一端标识升序。E1 与 E2、E3 等距配对，应选 E1—E2。
  // 网格：E1(1,1) E2(1,2) E3(2,1)，边界 (0,5) 很远；1×3 行 + 列。
  res = Solver.solve(
    fullSpec({
      rows: 3, cols: 4,
      boundaries: [[0, 3]],
      events: [[1, 1], [1, 2], [2, 1], [0, 0]],
    })
  );
  assert(res.ok, 'canonical partner-order solves');
  // E1(1,1): 到 E2=1，到 E3=1，到 E4=2；E4(0,0) 到边界=3、到 E2=3、到 E3=2
  // 最优：E1-E2(1)+E3-E4(2)=3 或 E1-E3(1)+E2-E4(3)=4 或 E1-E4(2)+E2-E3(2)=4…
  // 唯一最优为 E1-E2 + E3-E4，无需破同
  const pair = res.chains.find((c) => c.type === 'pair' && c.events.includes(0));
  assert(pair && pair.events.includes(1), 'E1 pairs E2, got ' + JSON.stringify(res.chains));

  // 构造真正同价的配对选择：E1 到 E2、E3 距离均为 1，E2、E3 到边界均远
  // 1×5：边界 (0,4)；事件 E1(0,1) E2(0,0) E3(0,2) E4(0,3)
  // E1-E2=1, E1-E3=1, E2-E3=2；E4 到边界=1。
  // 方案A：E1-E2 + E3-E4 = 1+1=2（E4 配对？E3-E4=1）… 重新核算：
  // E3(0,2)-E4(0,3)=1；E4→边界(0,4)=1；E2→边界=4；E3→边界=2；E1→边界=3
  // 方案A：E1-E2(1) + E3-E4(1) = 2
  // 方案B：E1-E3(1) + E2→边界(4) = 5
  // 方案C：E1-E2(1) + E3→边界(2) + E4→边界(1) = 4（奇数链数不行，须全消去）→ 非法组合数
  // 合法：全部两两配对或全边界：E1-E2+E3-E4=2 唯一最优？E2-E3(2)+E1-E4(2)=4。
  res = Solver.solve(
    fullSpec({ rows: 1, cols: 5, boundaries: [[0, 4]], events: [[0, 1], [0, 0], [0, 2], [0, 3]] })
  );
  assert(res.ok, 'line solves');
  assert(res.totalCost === 2, 'line cost 2, got ' + res.totalCost);

  // 同距边界：取边界标识较小者（按录入顺序）
  res = Solver.solve(
    fullSpec({ rows: 1, cols: 3, boundaries: [[0, 2], [0, 0]], events: [[0, 1], [0, 0]] })
  );
  assert(res.ok, 'boundary id tie solves');
  // E1(0,1) 到 B1(0,2) 与 B2(0,0) 距离均为 1 → 选 B1（录入在前）
  const ch0 = res.chains[res.assignments[0].chain];
  assert(ch0.type === 'boundary' && ch0.boundary === 0,
    'nearest boundary tie broken by input order, got boundary=' + ch0.boundary);
}

/* ---------- 确定性 ---------- */
function testDeterminism() {
  const rng = makeRng(999);
  for (let t = 0; t < 30; t++) {
    const rows = 3, cols = 3;
    const cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([r, c]);
    for (let k = cells.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      const tmp = cells[k]; cells[k] = cells[j]; cells[j] = tmp;
    }
    const spec = fullSpec({
      rows, cols,
      boundaries: cells.slice(0, 2),
      events: cells.slice(2, 6),
    });
    const a = Solver.solve(spec);
    const b = Solver.solve(JSON.parse(JSON.stringify(spec)));
    assert(JSON.stringify(a) === JSON.stringify(b), 'deterministic output');
  }
}

function run() {
  testValidation();
  const n = testEndToEnd();
  testCanonical();
  testDeterminism();
  return { endToEnd: n };
}

module.exports = { run };

if (require.main === module) {
  const info = run();
  console.log('solver tests passed', info);
}
