import { describe, expect, it } from 'vitest';
import { solve } from '../src/solver/solve';
import { GridModel, defaultGrid, edgeKey, vid } from '../src/solver/model';

/** 构造 rows×cols 码格；cost(r,c,dir) 给出边代价，dir='r' 向右、'd' 向下。 */
function makeGrid(
  rows: number,
  cols: number,
  cost: (r: number, c: number, dir: 'r' | 'd') => number | null,
  boundaries: [number, number][],
  events: [number, number][]
): GridModel {
  const edges: Record<string, number> = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) {
        const w = cost(r, c, 'r');
        if (w !== null) edges[edgeKey(vid(r, c, cols), vid(r, c + 1, cols))] = w;
      }
      if (r + 1 < rows) {
        const w = cost(r, c, 'd');
        if (w !== null) edges[edgeKey(vid(r, c, cols), vid(r + 1, c, cols))] = w;
      }
    }
  }
  return {
    rows,
    cols,
    edges,
    boundaries: boundaries.map(([r, c]) => vid(r, c, cols)),
    events: events.map(([r, c]) => vid(r, c, cols))
  };
}

/** 链方案签名：第 i 个录入事件 -> ['B', 边界序位] 或 ['P', 另一端事件下标]。 */
type Sig = Array<['B', number] | ['P', number]>;

function chainSignature(
  m: GridModel,
  chains: { kind: string; eventA: number; eventB: number | null; boundary: number | null }[]
): Sig {
  const boundaries = [...new Set(m.boundaries)].sort((a, b) => a - b);
  const sig: Sig = new Array(m.events.length);
  for (const c of chains) {
    if (c.kind === 'pair') {
      sig[c.eventA] = ['P', c.eventB!];
      sig[c.eventB!] = ['P', c.eventA];
    } else {
      sig[c.eventA] = ['B', boundaries.indexOf(c.boundary!)];
    }
  }
  return sig;
}

/** 独立暴力参考：枚举“配对 + 单挂边界”的所有划分，按（总代价, 链向量）取最优。 */
function bruteSolve(m: GridModel): { cost: number; sig: Sig } {
  const n = m.rows * m.cols;
  const adj: number[][] = Array.from({ length: n }, () => []);
  const w = new Map<string, number>();
  for (const [key, wt] of Object.entries(m.edges)) {
    const [a, b] = key.split('|').map(Number);
    adj[a].push(b);
    adj[b].push(a);
    w.set(`${a}-${b}`, wt);
    w.set(`${b}-${a}`, wt);
  }
  const k = m.events.length;
  // Floyd-Warshall
  const INF = Infinity;
  const D: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 0 : w.has(`${i}-${j}`) ? w.get(`${i}-${j}`)! : (INF as number)))
  );
  for (const t of Array(n).keys())
    for (const i of Array(n).keys())
      for (const j of Array(n).keys()) if (D[i][t] + D[t][j] < D[i][j]) D[i][j] = D[i][t] + D[t][j];

  const boundaries = [...new Set(m.boundaries)].sort((a, b) => a - b);
  const nb = boundaries.length;
  // 每事件的最优边界（先距离后序位）
  const bb: ({ bi: number; d: number } | null)[] = m.events.map((ev) => {
    let best: { bi: number; d: number } | null = null;
    for (let bi = 0; bi < boundaries.length; bi++) {
      const d = D[ev][boundaries[bi]];
      if (Number.isFinite(d) && (best === null || d < best.d)) best = { bi, d };
    }
    return best;
  });
  const pd = (i: number, j: number) => D[m.events[i]][m.events[j]];

  let bestCost = Infinity;
  let bestVec: number[] | null = null;
  let bestSig: Sig | null = null;
  const used = new Array<boolean>(k).fill(false);
  const vec = new Array<number>(k);
  const sig: Sig = new Array(k);

  const rec = (cost: number) => {
    const i = used.findIndex((u) => !u);
    if (i === -1) {
      if (cost < bestCost || (cost === bestCost && lexLess(vec, bestVec!))) {
        bestCost = cost;
        bestVec = vec.slice();
        bestSig = sig.slice();
      }
      return;
    }
    used[i] = true;
    // 方案 1：事件 i 挂边界
    const bbi = bb[i];
    if (bbi) {
      vec[i] = bbi.bi;
      sig[i] = ['B', bbi.bi];
      rec(cost + bbi.d);
    }
    // 方案 2：与任一未用事件配对
    for (let j = i + 1; j < k; j++) {
      if (used[j]) continue;
      const d = pd(i, j);
      if (!Number.isFinite(d)) continue;
      used[j] = true;
      vec[i] = nb + j;
      vec[j] = nb + i;
      sig[i] = ['P', j];
      sig[j] = ['P', i];
      rec(cost + d);
      used[j] = false;
    }
    used[i] = false;
  };
  rec(0);
  if (bestSig === null) throw new Error('暴力参考：无可行方案');
  return { cost: bestCost, sig: bestSig! };
}

function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('求解管线 — 关键场景', () => {
  it('局部最近边界并非全局最优：选择事件对而非两条边界链', () => {
    // 3×3 格，单位边。两事件位于中央相邻格 (1,1)、(1,2)；边界仅为上下两行。
    // 各自到最近边界距离均为 1（两条边界链合计 2），事件对距离 1（合计 1）。
    const m = makeGrid(
      3,
      3,
      () => 1,
      [
        [0, 0], [0, 1], [0, 2],
        [2, 0], [2, 1], [2, 2]
      ],
      [
        [1, 1],
        [1, 2]
      ]
    );
    const out = solve(m);
    expect(out.issues).toEqual([]);
    const r = out.result!;
    expect(r.totalCost).toBe(1);
    expect(r.chains).toHaveLength(1);
    expect(r.chains[0].kind).toBe('pair');
    // 逐边代价核对
    expect(r.chains[0].edges).toEqual([{ from: vid(1, 1, 3), to: vid(1, 2, 3), cost: 1 }]);
  });

  it('同成本时边界优先：1×5 线上两事件，成对与双边界等代价', () => {
    // 0--1--2--3--4，边界 {0,4}，事件 {1,3}：各挂边界合计 2，配对也是 2。
    const m = makeGrid(1, 5, () => 1, [[0, 0], [0, 4]], [[0, 1], [0, 3]]);
    const out = solve(m);
    expect(out.issues).toEqual([]);
    const r = out.result!;
    expect(r.totalCost).toBe(2);
    expect(r.chains.every((c) => c.kind === 'boundary')).toBe(true);
    expect(r.chains).toHaveLength(2);
    const ends = r.chains.map((c) => c.boundary).sort((a, b) => a! - b!);
    expect(ends).toEqual([0, 4]);
  });

  it('奇数个事件：恰一条边界链 + 其余成对', () => {
    const m = makeGrid(3, 3, () => 1, [[0, 0], [0, 2], [2, 0], [2, 2]], [
      [1, 1],
      [0, 1],
      [1, 0]
    ]);
    const out = solve(m);
    expect(out.issues).toEqual([]);
    const r = out.result!;
    expect(r.chains.filter((c) => c.kind === 'boundary')).toHaveLength(1);
    expect(r.chains.filter((c) => c.kind === 'pair')).toHaveLength(1);
    const covered = new Set<number>();
    r.chains.forEach((c) => {
      covered.add(c.eventA);
      if (c.eventB !== null) covered.add(c.eventB);
    });
    expect([...covered].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it('链逐边代价之和等于链代价，全部链合计等于总代价', () => {
    const m = makeGrid(4, 5, (r, c) => ((r + c) % 3) + 1, [[0, 0], [3, 4]], [
      [1, 1],
      [2, 3],
      [0, 3],
      [3, 1]
    ]);
    const r = solve(m).result!;
    for (const c of r.chains) {
      expect(c.edges.reduce((s, e) => s + e.cost, 0)).toBe(c.cost);
      // 边首尾相接
      for (let i = 0; i < c.edges.length; i++) {
        expect(c.edges[i].to).toBe(c.vertices[i + 1]);
        expect(c.edges[i].from).toBe(c.vertices[i]);
      }
    }
    expect(r.chains.reduce((s, c) => s + c.cost, 0)).toBe(r.totalCost);
  });
});

describe('求解管线 — 随机格网暴力对照（含 tie-break 链向量）', () => {
  const cases: { rows: number; cols: number; k: number; seed: number }[] = [];
  [
    [2, 3, 2], [2, 4, 3], [3, 3, 2], [3, 3, 3], [3, 4, 4], [3, 4, 5], [4, 4, 6]
  ].forEach(([rows, cols, k], idx) => {
    for (let t = 0; t < 30; t++) cases.push({ rows, cols, k, seed: idx * 100 + t });
  });

  for (const { rows, cols, k, seed } of cases) {
    it(`grid ${rows}x${cols} k=${k} seed=${seed}`, () => {
      const rand = rng(seed);
      const cost = () => (rand() < 0.12 ? null : 1 + Math.floor(rand() * 5));
      const cells = Array.from({ length: rows * cols }, (_, v) => v);
      // 边界：随机取外圈格点子集
      const border = cells.filter((v) => {
        const r = Math.floor(v / cols);
        const c = v % cols;
        return r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
      });
      const boundaries = border.filter(() => rand() < 0.8);
      const shuffled = cells.slice().sort(() => rand() - 0.5).slice(0, k);
      const m: GridModel = {
        rows,
        cols,
        edges: {},
        boundaries,
        events: shuffled
      };
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          if (c + 1 < cols) {
            const w = cost();
            if (w !== null) m.edges[edgeKey(vid(r, c, cols), vid(r, c + 1, cols))] = w;
          }
          if (r + 1 < rows) {
            const w = cost();
            if (w !== null) m.edges[edgeKey(vid(r, c, cols), vid(r + 1, c, cols))] = w;
          }
        }
      const out = solve(m);
      let ref: { cost: number; sig: Sig } | null = null;
      try {
        ref = bruteSolve(m);
      } catch {
        ref = null;
      }
      if (ref === null) {
        expect(out.issues.length).toBeGreaterThan(0);
        return;
      }
      expect(out.issues).toEqual([]);
      expect(out.result!.totalCost).toBe(ref.cost);
      expect(chainSignature(m, out.result!.chains)).toEqual(ref.sig);
      // 每个事件恰由一条链消去
      const covered = new Array<number>(k).fill(0);
      out.result!.chains.forEach((c) => {
        covered[c.eventA]++;
        if (c.eventB !== null) covered[c.eventB]++;
      });
      expect(covered.every((x) => x === 1)).toBe(true);
    });
  }
});

describe('求解管线 — 错误定位', () => {
  it('重复事件', () => {
    const m = defaultGrid();
    m.events = [0, 0];
    const out = solve(m);
    expect(out.issues.some((i) => i.code === 'duplicate_event' && i.vertex === 0)).toBe(true);
    expect(out.result).toBeUndefined();
  });

  it('越界边界', () => {
    const m = defaultGrid(2, 2);
    m.boundaries = [99];
    m.events = [0, 1];
    const out = solve(m);
    expect(out.issues.some((i) => i.code === 'boundary_out_of_grid' && i.vertex === 99)).toBe(true);
  });

  it('非正边代价', () => {
    const m = defaultGrid(2, 2);
    m.edges[edgeKey(0, 1)] = 0;
    m.events = [0, 3];
    const out = solve(m);
    expect(out.issues.some((i) => i.code === 'nonpositive_cost')).toBe(true);
  });

  it('无可达终点：孤立事件', () => {
    const m = makeGrid(
      3,
      3,
      (r, c, d) => {
        // 删除格点 (0,0) 的两条边
        if ((r === 0 && c === 0 && d === 'r') || (r === 0 && c === 0 && d === 'd')) return null;
        return 1;
      },
      [[2, 2]],
      [[0, 0], [1, 1]]
    );
    const out = solve(m);
    expect(out.issues.some((i) => i.code === 'unreachable_terminal' && i.vertex === 0)).toBe(true);
  });

  it('奇数事件且无边界：无解提示', () => {
    const m = makeGrid(2, 2, () => 1, [], [[0, 0], [0, 1], [1, 0]]);
    const out = solve(m);
    expect(out.issues.some((i) => i.code === 'no_feasible_matching')).toBe(true);
  });

  it('事件数量超出 2..48', () => {
    const m = defaultGrid();
    m.events = [0];
    expect(solve(m).issues.some((i) => i.code === 'event_count')).toBe(true);
    const m2 = defaultGrid(10, 10);
    m2.events = Array.from({ length: 49 }, (_, i) => i);
    expect(solve(m2).issues.some((i) => i.code === 'event_count')).toBe(true);
  });
});
