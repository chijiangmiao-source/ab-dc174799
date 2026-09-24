/**
 * 求解管线：
 *   1. 在矩形码格上以 Dijkstra 求事件两两之间、事件到各边界的最短链；
 *   2. 归约为一般图最小权完美匹配（Blossom，见 blossom.ts），精确 bigint 整数；
 *   3. 同成本时按事件录入顺序逐项比较链向量（边界优先，随后另一端标识），
 *      以 bigint 位权微扰一次性稳定选出规范解，不枚举配对。
 *
 * 匹配图构造（2k 个节点）：
 *   - 0..k-1：检测事件；
 *   - k..2k-1：k 个“边界副本”虚节点，代表一条边界链的终点槽位；
 *   - 事件—事件边 = 成对链；事件—副本边 = 边界链（同一权重连向每个副本）；
 *   - 副本两两之间为权 0 的边：未被使用的槽位自由配对，不影响目标函数。
 * 于是任意完美匹配中：事件两两配对（成对链）或与一个副本配对（边界链），
 * 边界链数 b 自动满足 k-b 为偶数，恰是物理可行条件。
 */

import { minWeightPerfectMatching } from './blossom';
import { GridModel, ValidationIssue, validateStructure, parseEdgeKey } from './model';

export interface PathEdge {
  from: number;
  to: number;
  cost: number;
}

export interface Chain {
  id: number;
  kind: 'pair' | 'boundary';
  /** 事件在录入序列中的下标（0 起） */
  eventA: number;
  /** 成对链：另一端事件下标；边界链为 null */
  eventB: number | null;
  /** 边界链终点格点；成对链为 null */
  boundary: number | null;
  /** 链经过的格点序列 */
  vertices: number[];
  /** 逐边代价 */
  edges: PathEdge[];
  cost: number;
  /** 连接依据：eventA 到其最近边界的代价（不可达为 null） */
  eventANearestBoundary: number | null;
  /** 成对链：eventB 到其最近边界的代价 */
  eventBNearestBoundary: number | null;
}

export interface SolveResult {
  chains: Chain[];
  totalCost: number;
}

interface AdjEntry {
  to: number;
  cost: number;
}

class MinHeap {
  private a: { d: number; v: number }[] = [];

  get size(): number {
    return this.a.length;
  }

  push(d: number, v: number): void {
    const a = this.a;
    a.push({ d, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].d <= a[i].d) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop(): { d: number; v: number } {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      const n = a.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && a[l].d < a[m].d) m = l;
        if (r < n && a[r].d < a[m].d) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

interface DijkstraTree {
  dist: Int32Array; // -1 = 不可达
  pred: Int32Array; // 前驱格点，-1 = 源/不可达
  predCost: Int32Array;
}

/** 单源 Dijkstra（正整数边权）；等距时取编号更小的前驱，路径确定性可复现。 */
function dijkstra(adj: AdjEntry[][], source: number): DijkstraTree {
  const n = adj.length;
  const dist = new Int32Array(n).fill(-1);
  const pred = new Int32Array(n).fill(-1);
  const predCost = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  dist[source] = 0;
  heap.push(0, source);
  while (heap.size) {
    const { d, v } = heap.pop();
    if (d !== dist[v]) continue;
    for (const e of adj[v]) {
      const nd = d + e.cost;
      const old = dist[e.to];
      if (old === -1 || nd < old || (nd === old && v < pred[e.to])) {
        dist[e.to] = nd;
        pred[e.to] = v;
        predCost[e.to] = e.cost;
        heap.push(nd, e.to);
      }
    }
  }
  return { dist, pred, predCost };
}

function reconstruct(tree: DijkstraTree, to: number): { vertices: number[]; edges: PathEdge[] } | null {
  if (tree.dist[to] === -1) return null;
  const verticesRev: number[] = [to];
  const edges: PathEdge[] = [];
  let cur = to;
  while (tree.pred[cur] !== -1) {
    const p = tree.pred[cur];
    edges.push({ from: p, to: cur, cost: tree.predCost[cur] });
    verticesRev.push(p);
    cur = p;
  }
  verticesRev.reverse();
  edges.reverse();
  return { vertices: verticesRev, edges };
}

function buildAdjacency(m: GridModel): AdjEntry[][] {
  const n = m.rows * m.cols;
  const adj: AdjEntry[][] = Array.from({ length: n }, () => []);
  for (const [key, w] of Object.entries(m.edges)) {
    const [a, b] = parseEdgeKey(key);
    if (a < 0 || b < 0 || a >= n || b >= n) continue;
    adj[a].push({ to: b, cost: w });
    adj[b].push({ to: a, cost: w });
  }
  return adj;
}

export interface SolveOutcome {
  result?: SolveResult;
  issues: ValidationIssue[];
}

export function solve(m: GridModel): SolveOutcome {
  const issues = validateStructure(m);
  if (issues.length) return { issues };

  const k = m.events.length;
  const adj = buildAdjacency(m);

  // 边界去重并按格点编号升序：边界序位即“另一端标识”。
  const boundaries = [...new Set(m.boundaries)].sort((a, b) => a - b);
  const nb = boundaries.length;

  // 最短链：每个事件一棵 Dijkstra 树（事件间距离 + 事件→各事件路径），
  // 每个边界一棵（事件→边界距离，惰性缓存）。
  const eventTrees = m.events.map((ev) => dijkstra(adj, ev));
  const boundaryTrees = new Map<number, DijkstraTree>();
  const treeForBoundary = (b: number) => {
    let t = boundaryTrees.get(b);
    if (!t) {
      t = dijkstra(adj, b);
      boundaryTrees.set(b, t);
    }
    return t;
  };

  // 可达性定位：事件到不了任何其他事件，也到不了任何边界。
  for (let i = 0; i < k; i++) {
    let reachable = false;
    for (let j = 0; j < k; j++) {
      if (j !== i && eventTrees[i].dist[m.events[j]] !== -1) {
        reachable = true;
        break;
      }
    }
    if (!reachable) {
      for (const b of boundaries) {
        if (treeForBoundary(b).dist[m.events[i]] !== -1) {
          reachable = true;
          break;
        }
      }
    }
    if (!reachable) {
      issues.push({
        code: 'unreachable_terminal',
        message: `第 ${i + 1} 个事件（格点 ${m.events[i]}）无法到达任何其他事件或边界，没有可消去它的链`,
        eventIndex: i,
        vertex: m.events[i]
      });
    }
  }
  if (issues.length) return { issues };

  // 事件 i → 最近边界（先比链长，同长取格点编号更小的边界）。
  const bestBoundary = new Array<{ bi: number; d: number } | undefined>(k);
  for (let i = 0; i < k; i++) {
    let pick: { bi: number; d: number } | null = null;
    for (let bi = 0; bi < nb; bi++) {
      const d = treeForBoundary(boundaries[bi]).dist[m.events[i]];
      if (d !== -1 && (pick === null || d < pick.d || (d === pick.d && boundaries[bi] < boundaries[pick.bi]))) {
        pick = { bi, d };
      }
    }
    if (pick) bestBoundary[i] = pick;
  }

  // ---- 位权微扰：主代价 * Q^k + 逐项链向量序位 ------------------------
  // 事件位置 i 的序位：边界链 = 所选边界序位 bi（0..nb-1）；
  // 成对链 (i,j) = nb + 另一端录入下标 j。边界序位恒小于成对序位，实现“边界优先”。
  const N = 2 * k;
  const Q = BigInt(nb + k + 1);
  let Qk = 1n;
  for (let t = 0; t < k; t++) Qk *= Q;
  const posWeight = (i: number) => {
    let w = 1n;
    for (let t = 0; t < k - 1 - i; t++) w *= Q;
    return w;
  };

  interface MEdge {
    u: number;
    v: number;
    w: bigint;
  }
  const medges: MEdge[] = [];

  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const d = eventTrees[i].dist[m.events[j]];
      if (d === -1) continue;
      const penalty = (BigInt(nb) + BigInt(j)) * posWeight(i) + (BigInt(nb) + BigInt(i)) * posWeight(j);
      medges.push({ u: i, v: j, w: BigInt(d) * Qk + penalty });
    }
  }
  for (let i = 0; i < k; i++) {
    const pick = bestBoundary[i];
    if (!pick) continue;
    const w = BigInt(pick.d) * Qk + BigInt(pick.bi) * posWeight(i);
    for (let slot = 0; slot < k; slot++) medges.push({ u: i, v: k + slot, w });
  }
  // 未使用的边界槽位两两零权配对。
  for (let a = k; a < N; a++) {
    for (let b = a + 1; b < N; b++) medges.push({ u: a, v: b, w: 0n });
  }

  let pairs: [number, number][];
  try {
    pairs = minWeightPerfectMatching(medges, N);
  } catch (e) {
    issues.push({
      code: 'no_feasible_matching',
      message:
        k % 2 === 1 && nb === 0
          ? `事件数为奇数（${k}）且没有可作终点的边界：成对链只能消去偶数个事件，无解`
          : `当前格图中不存在使每个事件恰由一条链消去的方案（部分事件之间、到边界互不连通）：${(e as Error).message}`
    });
    return { issues };
  }

  // ---- 解码为链 --------------------------------------------------------
  const usedEvent = new Array<boolean>(k).fill(false);
  const chains: Chain[] = [];
  let totalCost = 0;

  for (let [a, b] of pairs) {
    if (a >= k && b >= k) continue; // 空闲槽位配对，不产生链
    let ev: number;
    let other: number;
    if (a < k && b < k) {
      ev = Math.min(a, b);
      other = Math.max(a, b);
    } else {
      ev = a < k ? a : b;
      other = -1;
    }
    if (usedEvent[ev] || (other !== -1 && usedEvent[other])) {
      issues.push({ code: 'no_feasible_matching', message: '匹配结果重复使用了事件' });
      return { issues };
    }
    usedEvent[ev] = true;

    if (other !== -1) {
      usedEvent[other] = true;
      const path = reconstruct(eventTrees[ev], m.events[other]);
      const cost = eventTrees[ev].dist[m.events[other]];
      if (!path) {
        issues.push({ code: 'no_feasible_matching', message: `事件 ${ev + 1} 与事件 ${other + 1} 的最短链重建失败` });
        return { issues };
      }
      chains.push({
        id: 0,
        kind: 'pair',
        eventA: ev,
        eventB: other,
        boundary: null,
        vertices: path.vertices,
        edges: path.edges,
        cost,
        eventANearestBoundary: bestBoundary[ev]?.d ?? null,
        eventBNearestBoundary: bestBoundary[other]?.d ?? null
      });
      totalCost += cost;
    } else {
      const pick = bestBoundary[ev];
      if (!pick) {
        issues.push({ code: 'no_feasible_matching', message: `事件 ${ev + 1} 找不到可达边界` });
        return { issues };
      }
      const tree = treeForBoundary(boundaries[pick.bi]);
      const path = reconstruct(tree, m.events[ev]);
      if (!path) {
        issues.push({ code: 'no_feasible_matching', message: `事件 ${ev + 1} 到边界格点 ${boundaries[pick.bi]} 的最短链重建失败` });
        return { issues };
      }
      chains.push({
        id: 0,
        kind: 'boundary',
        eventA: ev,
        eventB: null,
        boundary: boundaries[pick.bi],
        vertices: path.vertices,
        edges: path.edges,
        cost: pick.d,
        eventANearestBoundary: pick.d,
        eventBNearestBoundary: null
      });
      totalCost += pick.d;
    }
  }

  if (usedEvent.some((u) => !u)) {
    issues.push({ code: 'no_feasible_matching', message: '匹配结果未覆盖全部事件' });
    return { issues };
  }

  chains.sort((x, y) => x.eventA - y.eventA);
  chains.forEach((c, idx) => (c.id = idx));

  return { result: { chains, totalCost }, issues: [] };
}
