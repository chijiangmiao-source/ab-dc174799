import { describe, expect, it } from 'vitest';
import { minWeightPerfectMatching, Edge } from '../src/solver/blossom';

/** 暴力枚举所有完美匹配，返回最小权重（n <= 10）。 */
function bruteForceMWPM(edges: Edge[], n: number): bigint | null {
  const w = new Map<string, bigint>();
  const k = (u: number, v: number) => (u < v ? `${u}|${v}` : `${v}|${u}`);
  for (const e of edges) w.set(k(e.u, e.v), e.w);
  let best: bigint | null = null;
  const used = new Array<boolean>(n).fill(false);
  const rec = (cost: bigint) => {
    const i = used.findIndex((u) => !u);
    if (i === -1) {
      if (best === null || cost < best) best = cost;
      return;
    }
    used[i] = true;
    for (let j = i + 1; j < n; j++) {
      if (used[j]) continue;
      const wij = w.get(k(i, j));
      if (wij === undefined) continue;
      used[j] = true;
      rec(cost + wij);
      used[j] = false;
    }
    used[i] = false;
  };
  rec(0n);
  return best;
}

function matchingWeight(pairs: [number, number][], edges: Edge[]): bigint {
  const w = new Map<string, bigint>();
  const k = (u: number, v: number) => (u < v ? `${u}|${v}` : `${v}|${u}`);
  for (const e of edges) w.set(k(e.u, e.v), e.w);
  return pairs.reduce((s, [u, v]) => s + w.get(k(u, v))!, 0n);
}

/** 确定性伪随机，保证测试可复现。 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('minWeightPerfectMatching — 与暴力枚举对照', () => {
  it('小图随机完全图（偶数顶点）', () => {
    const rand = rng(20260924);
    for (let n = 2; n <= 10; n += 2) {
      for (let trial = 0; trial < 60; trial++) {
        const edges: Edge[] = [];
        for (let u = 0; u < n; u++) {
          for (let v = u + 1; v < n; v++) {
            edges.push({ u, v, w: BigInt(1 + Math.floor(rand() * 20)) });
          }
        }
        const pairs = minWeightPerfectMatching(edges, n);
        const expect2 = bruteForceMWPM(edges, n);
        expect(matchingWeight(pairs, edges)).toBe(expect2);
        // 确为完美匹配
        const seen = new Array<number>(n).fill(0);
        for (const [a, b] of pairs) {
          seen[a]++;
          seen[b]++;
        }
        expect(seen.every((c) => c === 1)).toBe(true);
      }
    }
  });

  it('稀疏图与含奇环（必须收缩 blossom）的图', () => {
    // 5 顶点奇花 + 一顶点：花内边权大，外部结构检验 blossom 收缩/扩张。
    const cases: { n: number; edges: [number, number, number][] }[] = [
      {
        // 三角形 0-1-2，3 连所有，4 连 3：权重制造非平凡花
        n: 4,
        edges: [
          [0, 1, 1],
          [1, 2, 1],
          [0, 2, 1],
          [0, 3, 5],
          [1, 3, 5],
          [2, 3, 1]
        ]
      },
      {
        // 经典示例：两个三角形通过一条边相连
        n: 6,
        edges: [
          [0, 1, 2],
          [1, 2, 2],
          [0, 2, 2],
          [3, 4, 2],
          [4, 5, 2],
          [3, 5, 2],
          [2, 3, 1],
          [0, 3, 9],
          [1, 4, 9],
          [2, 5, 9]
        ]
      }
    ];
    for (const c of cases) {
      const edges: Edge[] = c.edges.map(([u, v, w]) => ({ u, v, w: BigInt(w) }));
      const pairs = minWeightPerfectMatching(edges, c.n);
      expect(matchingWeight(pairs, edges)).toBe(bruteForceMWPM(edges, c.n));
    }
  });

  it('大整数权重精确（超过 Number 安全整数）', () => {
    const B = 10n ** 30n;
    const edges: Edge[] = [
      { u: 0, v: 1, w: B + 3n },
      { u: 2, v: 3, w: B + 3n },
      { u: 0, v: 2, w: B + 1n },
      { u: 1, v: 3, w: B + 1n },
      { u: 0, v: 3, w: B + 2n },
      { u: 1, v: 2, w: B + 2n }
    ];
    const pairs = minWeightPerfectMatching(edges, 4);
    expect(matchingWeight(pairs, edges)).toBe(2n * B + 2n);
  });

  it('随机稀疏图（大量花收缩/扩张路径）', () => {
    const rand = rng(777);
    for (let n = 4; n <= 10; n += 2) {
      for (let trial = 0; trial < 200; trial++) {
        const edges: Edge[] = [];
        const present = new Set<string>();
        // 以约 0.55 概率留边，保证偶数节点上常存在完美匹配
        for (let u = 0; u < n; u++) {
          for (let v = u + 1; v < n; v++) {
            if (rand() < 0.55) {
              const key = `${u}|${v}`;
              present.add(key);
              edges.push({ u, v, w: BigInt(1 + Math.floor(rand() * 30)) });
            }
          }
        }
        const optimum = bruteForceMWPM(edges, n);
        if (optimum === null) continue; // 该随机图无完美匹配
        const pairs = minWeightPerfectMatching(edges, n);
        expect(matchingWeight(pairs, edges)).toBe(optimum);
      }
    }
  });

  it('48 规模（96 节点归约图量级）可在合理时间完成', () => {
    const n = 48;
    const rand = rng(424242);
    const edges: Edge[] = [];
    for (let u = 0; u < n; u++) {
      for (let v = u + 1; v < n; v++) {
        edges.push({ u, v, w: BigInt(1 + Math.floor(rand() * 100000)) });
      }
    }
    const t0 = Date.now();
    const pairs = minWeightPerfectMatching(edges, n);
    expect(pairs.length).toBe(n / 2);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('不存在完美匹配时抛出', () => {
    expect(() => minWeightPerfectMatching([{ u: 0, v: 1, w: 1n }], 4)).toThrow();
    expect(() => minWeightPerfectMatching([], 2)).toThrow();
    expect(() => minWeightPerfectMatching([], 3)).toThrow(/奇数/);
  });
});
