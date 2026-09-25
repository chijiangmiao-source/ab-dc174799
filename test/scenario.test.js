/*
 * 验收场景：构造“每个事件局部最近边界并非全局最优”的格图，
 * 确认求解器选择事件配对链，而不是两条各自连边界的链。
 */
'use strict';

const Solver = require('../src/solver.js');

function assert(cond, msg) {
  if (!cond) throw new Error('scenario test failed: ' + msg);
}

// 场景：1×6 线性格，边界在两端 (0,0) 与 (0,5)，事件 E1 在 (0,1)、E2 在 (0,2)。
//   E1 最近边界距离 1（到 (0,0)），E2 最近边界距离 2 → 机械连边界总代价 3
//   E1—E2 配对链代价 1 → 全局最优总代价 1
function scenarioSpec() {
  return {
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
  };
}

function run() {
  const spec = scenarioSpec();
  const res = Solver.solve(spec);
  assert(res.ok, 'scenario solves: ' + JSON.stringify(res.errors));

  // 贪心基线：每个事件机械连向最近边界
  const greedy = res.diagnostics.greedyBoundaryTotal;
  assert(greedy === 3, 'greedy nearest-boundary baseline is 3, got ' + greedy);

  // 全局最优必须严格更低，且选择事件配对而非两条边界链
  assert(res.totalCost === 1, 'optimal total cost is 1, got ' + res.totalCost);
  assert(res.chains.length === 1, 'exactly one chain, got ' + res.chains.length);
  const chain = res.chains[0];
  assert(chain.type === 'pair', 'chain is an event pair, not boundary chains');
  assert(chain.events[0] === 0 && chain.events[1] === 1, 'chain pairs E1 and E2');
  assert(chain.cost === 1, 'pair chain cost 1');
  assert(
    chain.path.length === 2 && chain.edgeCosts.length === 1 && chain.edgeCosts[0] === 1,
    'pair chain path has one edge of cost 1'
  );
  assert(res.totalCost < greedy, 'pairing beats mechanical nearest-boundary');

  return { greedy: greedy, optimal: res.totalCost };
}

module.exports = { run, scenarioSpec };

if (require.main === module) {
  const info = run();
  console.log('scenario test passed', info);
}
