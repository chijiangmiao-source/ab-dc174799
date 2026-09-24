/**
 * verify 验收第 1 步（在全部其它检查之前）：
 * 在“局部最近边界并非全局最优”的格图上，确认求解器选择事件对，
 * 而不是把每个事件机械连向最近边界。
 *
 * 通过 vite-node 执行（直接引用 TypeScript 求解器源码）。
 * 断言失败时进程以非零码退出。
 */
import { solve } from '../src/solver/solve';
import { GridModel, edgeKey, vid } from '../src/solver/model';

function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) fail(msg);
  console.log(`  ✓ ${msg}`);
}

// 3×5 矩形码格，全部边代价 1；边界仅为上、下两行。
const rows = 3;
const cols = 5;
const edges: Record<string, number> = {};
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    if (c + 1 < cols) edges[edgeKey(vid(r, c, cols), vid(r, c + 1, cols))] = 1;
    if (r + 1 < rows) edges[edgeKey(vid(r, c, cols), vid(r + 1, c, cols))] = 1;
  }
}
const boundaries: number[] = [];
for (let c = 0; c < cols; c++) {
  boundaries.push(vid(0, c, cols));
  boundaries.push(vid(2, c, cols));
}
// 两个检测事件位于中行相邻格 (1,1)、(1,2)。
const model: GridModel = {
  rows,
  cols,
  edges,
  boundaries,
  events: [vid(1, 1, cols), vid(1, 2, cols)]
};

const out = solve(model);
assert(out.issues.length === 0, `求解无结构/可达性问题（实际：${out.issues.map((i) => i.message).join('；') || '无'}）`);
const r = out.result!;

const e1 = vid(1, 1, cols);
const e2 = vid(1, 2, cols);
const nearestBoundaryEach = 1 + 1; // 每个事件到最近边界距离均为 1
assert(r.totalCost === 1, `全局最优总代价为 1（事件对链），实际 ${r.totalCost}`);
assert(
  r.totalCost < nearestBoundaryEach,
  `成对解释（${r.totalCost}）严格便宜于两条最近边界链（${nearestBoundaryEach}）`
);
assert(r.chains.length === 1, `恰好一条链消去两个事件，实际 ${r.chains.length} 条`);
assert(r.chains[0].kind === 'pair', `该链为事件对链而非两条边界链`);
assert(
  r.chains[0].vertices[0] === e1 && r.chains[0].vertices[r.chains[0].vertices.length - 1] === e2,
  `事件对链端点为事件 ${e1}、${e2}`
);
assert(
  r.chains[0].edges.length === 1 && r.chains[0].edges[0].cost === 1,
  `逐边代价为单条边、代价 1（可在结果页列出）`
);

console.log('  → 局部最近边界并非全局最优：求解器正确选择事件对。');
