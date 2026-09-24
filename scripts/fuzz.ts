// 随机生成稀疏图，输出边表与（失败时）交给 Python oracle 对照，逐步缩小。
// 用法: node --import tsx scripts/fuzz.ts seed n p
import { minWeightPerfectMatching, Edge } from '../src/solver/blossom';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function gen(seed: number, n: number, p: number): Edge[] {
  const rand = rng(seed);
  const edges: Edge[] = [];
  for (let u = 0; u < n; u++)
    for (let v = u + 1; v < n; v++)
      if (rand() < p) edges.push({ u, v, w: BigInt(1 + Math.floor(rand() * 30)) });
  return edges;
}

function hasPerfect(edges: Edge[], n: number): boolean {
  const a = new Set(edges.map((e) => `${e.u}-${e.v}`));
  const used = new Array(n).fill(false);
  const dfs = (): boolean => {
    const i = used.findIndex((x) => !x);
    if (i === -1) return true;
    used[i] = true;
    for (let j = i + 1; j < n; j++)
      if (!used[j] && a.has(`${i}-${j}`)) {
        used[j] = true;
        if (dfs()) return true;
        used[j] = false;
      }
    used[i] = false;
    return false;
  };
  return dfs();
}

function matchingWeight(pairs: [number, number][], edges: Edge[]): bigint {
  const wm = new Map<string, bigint>();
  const kk = (u: number, v: number) => (u < v ? `${u}|${v}` : `${v}|${u}`);
  for (const e of edges) wm.set(kk(e.u, e.v), e.w);
  return pairs.reduce((s, [u, v]) => s + wm.get(kk(u, v))!, 0n);
}

function bruteOpt(edges: Edge[], n: number): bigint | null {
  const wm = new Map<string, bigint>();
  const kk = (u: number, v: number) => (u < v ? `${u}|${v}` : `${v}|${u}`);
  for (const e of edges) wm.set(kk(e.u, e.v), e.w);
  let best: bigint | null = null;
  const used = new Array(n).fill(false);
  const rec = (cost: bigint) => {
    const i = used.findIndex((x) => !x);
    if (i === -1) { if (best === null || cost < best) best = cost; return; }
    used[i] = true;
    for (let j = i + 1; j < n; j++) {
      const wij = wm.get(kk(i, j));
      if (used[j] || wij === undefined) continue;
      used[j] = true;
      rec(cost + wij);
      used[j] = false;
    }
    used[i] = false;
  };
  rec(0n);
  return best;
}

const mode = process.argv[2];
if (mode === 'find') {
  let checked = 0;
  for (const p of [0.25, 0.5, 0.8]) {
    for (let n = 4; n <= 12; n += 2) {
      for (let seed = 1; seed < 800; seed++) {
        const edges = gen(seed, n, p);
        if (!hasPerfect(edges, n)) continue;
        const pairs = minWeightPerfectMatching(edges, n);
        const got = matchingWeight(pairs, edges);
        const want = bruteOpt(edges, n);
        checked++;
        if (got !== want) {
          console.log(`WEIGHT FAIL n=${n} p=${p} seed=${seed} got=${got} want=${want}`);
          process.exit(1);
        }
      }
    }
  }
  console.log(`weight-checked ${checked} feasible instances: all optimal`);
} else if (mode === 'dump') {
  const seed = Number(process.argv[3]);
  const n = Number(process.argv[4]);
  const p = Number(process.argv[5]);
  const edges = gen(seed, n, p);
  console.log(JSON.stringify({ n, edges: edges.map((e) => [e.u, e.v, Number(e.w)]) }));
}
