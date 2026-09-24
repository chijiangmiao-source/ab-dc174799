/**
 * 一般图最大权匹配（Galil/Edmonds primal-dual blossom 算法）的 TypeScript 移植。
 *
 * 算法与整数不变量严格对应 NetworkX networkx.algorithms.matching.max_weight_matching
 * （"Efficient Algorithms for Finding Maximum Matching in Graphs", Zvi Galil, 1986）：
 * 边权为整数时全程只做整数运算。这里以 bigint 承载，保证任意大整数代价精确。
 *
 * 该实现不做任何贪心/枚举：每阶段沿允许边（零松弛）增广，找不到增广路时
 * 按 delta1..delta4 调整对偶变量并扩张/收缩花，直至取得最优完美匹配。
 */

export interface WeightedGraph {
  /** 顶点数，顶点编号 0..n-1 */
  n: number;
  /** 邻接表（无向边双向登记） */
  adj: number[][];
  /** 边权（无向，调用方保证对称），缺失视为不存在 */
  weight(u: number, v: number): bigint;
}

interface Blossom {
  /** 子花列表，自基顶点起沿花环绕 */
  childs: BO[];
  /** childs[i] 与 childs[i+1] 之间的连接边 (顶点对) */
  edges: [number, number][];
  /** 通往邻近 S 花的最小松弛边缓存 */
  mybestedges: [number, number][] | null;
}

type BO = number | Blossom;

const isBlossom = (x: BO): x is Blossom => typeof x === 'object';

function leavesOf(b: BO): number[] {
  const out: number[] = [];
  const stack: BO[] = [b];
  while (stack.length) {
    const t = stack.pop()!;
    if (isBlossom(t)) stack.push(...t.childs);
    else out.push(t);
  }
  return out;
}

/**
 * 最大权完美匹配（maxcardinality = true）。
 * 返回 mate 数组：mate[v] 为配对顶点；调用方须保证图允许完美匹配。
 */
export function maxWeightMatching(G: WeightedGraph): Int32Array {
  const { n, adj } = G;
  const mate = new Int32Array(n).fill(-1);

  const label = new Map<BO, number | undefined>();
  const labeledge = new Map<BO, [number, number] | null>();
  const inblossom: BO[] = Array.from({ length: n }, (_, v) => v);
  // 与 NetworkX 一致：所有平凡顶点最初都在父花表中登记为 null。
  const blossomparent = new Map<BO, Blossom | null>();
  for (let v = 0; v < n; v++) blossomparent.set(v, null);
  const blossombase = new Map<BO, number>();
  for (let v = 0; v < n; v++) blossombase.set(v, v);
  const bestedge = new Map<BO, [number, number] | null>();
  const blossomdual = new Map<Blossom, bigint>();
  const allowedge = new Set<number>();
  const enc = (v: number, w: number) => v * n + w;
  const queue: number[] = [];

  // 最大边权；顶点对偶初值 = maxweight（即 2*u(v)）。
  let maxweight = 0n;
  for (let v = 0; v < n; v++) {
    for (const w of adj[v]) {
      if (w > v) {
        const wt = G.weight(v, w);
        if (wt > maxweight) maxweight = wt;
      }
    }
  }
  const dualvar = new BigInt64Array(n).fill(maxweight);

  const slack = (v: number, w: number): bigint =>
    dualvar[v] + dualvar[w] - 2n * G.weight(v, w);

  function assignLabel(w: number, t: number, v: number | null): void {
    const b = inblossom[w];
    if (label.get(w) !== undefined || label.get(b) !== undefined) {
      throw new Error('blossom 不变量被破坏：顶点已带标签');
    }
    label.set(w, t);
    label.set(b, t);
    const le: [number, number] | null = v === null ? null : [v, w];
    labeledge.set(w, le);
    labeledge.set(b, le);
    bestedge.set(w, null);
    bestedge.set(b, null);
    if (t === 1) {
      if (isBlossom(b)) queue.push(...leavesOf(b));
      else queue.push(b as number);
    } else if (t === 2) {
      const base = blossombase.get(b)!;
      assignLabel(mate[base], 1, base);
    }
  }

  const NO_NODE = -2;
  function scanBlossom(vIn: number, wIn: number): number {
    let v: number = vIn;
    let w: number = wIn;
    const path: BO[] = [];
    let base: number = NO_NODE;
    while (v !== NO_NODE) {
      const b = inblossom[v];
      const lb = label.get(b);
      if (lb !== undefined && (lb & 4) !== 0) {
        base = blossombase.get(b)!;
        break;
      }
      if (lb !== 1) throw new Error('blossom 不变量被破坏：回溯路径上出现非 S 花');
      path.push(b);
      label.set(b, 5);
      const le = labeledge.get(b) ?? null;
      if (le === null) {
        v = NO_NODE;
      } else {
        v = le[0];
        const b2 = inblossom[v];
        if (label.get(b2) !== 2) throw new Error('blossom 不变量被破坏：缺少 T 花');
        v = (labeledge.get(b2)!)[0];
      }
      if (w !== NO_NODE) {
        const tmp = v;
        v = w;
        w = tmp;
      }
    }
    for (const b of path) label.set(b, 1);
    return base;
  }

  function addBlossom(base: number, vIn: number, wIn: number): Blossom {
    let v = vIn;
    let w = wIn;
    const bb = inblossom[base];
    let bv = inblossom[v];
    let bw = inblossom[w];
    const b: Blossom = { childs: [], edges: [], mybestedges: null };
    blossombase.set(b, base);
    blossomparent.set(b, null);
    blossomparent.set(bb as Blossom, b);
    const path = b.childs;
    const edgs = b.edges;
    edgs.push([v, w]);
    while (bv !== bb) {
      blossomparent.set(bv as Blossom, b);
      path.push(bv);
      edgs.push(labeledge.get(bv)!);
      v = (labeledge.get(bv)!)[0];
      bv = inblossom[v];
    }
    path.push(bb);
    path.reverse();
    edgs.reverse();
    while (bw !== bb) {
      blossomparent.set(bw as Blossom, b);
      path.push(bw);
      const le = labeledge.get(bw)!;
      edgs.push([le[1], le[0]]);
      w = le[0];
      bw = inblossom[w];
    }
    if (label.get(bb) !== 1) throw new Error('blossom 不变量被破坏：基花非 S');
    label.set(b, 1);
    labeledge.set(b, labeledge.get(bb) ?? null);
    blossomdual.set(b, 0n);
    for (const lf of leavesOf(b)) {
      if (label.get(inblossom[lf]) === 2) queue.push(lf);
      inblossom[lf] = b;
    }
    const bestedgeto = new Map<BO, [number, number]>();
    for (const bvItem of path) {
      let nblist: [number, number][];
      if (isBlossom(bvItem)) {
        if (bvItem.mybestedges !== null) {
          nblist = bvItem.mybestedges;
          bvItem.mybestedges = null;
        } else {
          nblist = [];
          for (const vx of leavesOf(bvItem)) for (const wx of adj[vx]) if (vx !== wx) nblist.push([vx, wx]);
        }
      } else {
        const vx = bvItem;
        nblist = [];
        for (const wx of adj[vx]) if (vx !== wx) nblist.push([vx, wx]);
      }
      for (const k of nblist) {
        let i = k[0];
        let j = k[1];
        if (inblossom[j] === b) {
          i = k[1];
          j = k[0];
        }
        const bj = inblossom[j];
        if (
          bj !== b &&
          label.get(bj) === 1 &&
          (!bestedgeto.has(bj) || slack(i, j) < slack(...(bestedgeto.get(bj)!)))
        ) {
          bestedgeto.set(bj, [i, j]);
        }
      }
      bestedge.set(bvItem, null);
    }
    b.mybestedges = [...bestedgeto.values()];
    let mybestedge: [number, number] | null = null;
    let mybestslack = 0n;
    bestedge.set(b, null);
    for (const k of b.mybestedges) {
      const ks = slack(...k);
      if (mybestedge === null || ks < mybestslack) {
        mybestedge = k;
        mybestslack = ks;
      }
    }
    bestedge.set(b, mybestedge);
    return b;
  }

  function expandBlossom(b: Blossom, endstage: boolean): void {
    function* recurse(bb: Blossom, es: boolean): Generator<Blossom> {
      for (const s of bb.childs) {
        blossomparent.set(s, null);
        if (isBlossom(s)) {
          if (es && blossomdual.get(s)! === 0n) {
            yield s;
          } else {
            for (const vx of leavesOf(s)) inblossom[vx] = s;
          }
        } else {
          inblossom[s] = s;
        }
      }
      if (!es && label.get(bb) === 2) {
        const L = bb.childs.length;
        const at = (x: number): BO => bb.childs[((x % L) + L) % L];
        const eAt = (x: number): [number, number] => bb.edges[((x % L) + L) % L];
        const entrychild = inblossom[(labeledge.get(bb)!)[1]];
        let j = bb.childs.indexOf(entrychild);
        let jstep: number;
        if (j & 1) {
          j -= bb.childs.length;
          jstep = 1;
        } else {
          jstep = -1;
        }
        let [v, w] = labeledge.get(bb)!;
        while (j !== 0) {
          let p: number, q: number;
          if (jstep === 1) [p, q] = eAt(j);
          else [q, p] = eAt(j - 1);
          label.set(w, undefined);
          label.set(q, undefined);
          assignLabel(w, 2, v);
          allowedge.add(enc(p, q));
          allowedge.add(enc(q, p));
          j += jstep;
          if (jstep === 1) [v, w] = eAt(j);
          else [w, v] = eAt(j - 1);
          allowedge.add(enc(v, w));
          allowedge.add(enc(w, v));
          j += jstep;
        }
        const bw = at(j);
        label.set(w, 2);
        label.set(bw, 2);
        labeledge.set(w, [v, w]);
        labeledge.set(bw, [v, w]);
        bestedge.set(bw, null);
        j += jstep;
        while (at(j) !== entrychild) {
          const bv = at(j);
          // 该子花已在重标过程中成为 S：保持原样跳过（对应 Python label.get(bv)==1）。
          if (label.get(bv) === 1) {
            j += jstep;
            continue;
          }
          // 在子花中寻找一个带标签（可达）的叶顶点；平凡子花即其自身。
          let vx: number | undefined;
          if (isBlossom(bv)) {
            for (const lf of leavesOf(bv)) {
              if (label.get(lf) !== undefined) {
                vx = lf;
                break;
              }
            }
          } else if (label.get(bv) !== undefined) {
            vx = bv;
          }
          // 子花含可达顶点：沿可达边将其标为 T（对应 Python 的 label.get(v) 门控）。
          if (vx !== undefined) {
            if (label.get(vx) !== 2) throw new Error('blossom 不变量被破坏：可达顶点非 T 标签');
            if (inblossom[vx] !== bv) throw new Error('blossom 不变量被破坏：顶点归属不符');
            label.set(vx, undefined);
            label.set(mate[blossombase.get(bv)!], undefined);
            assignLabel(vx, 2, (labeledge.get(vx)!)[0]);
          }
          j += jstep;
        }
      }
      label.delete(bb);
      labeledge.delete(bb);
      bestedge.delete(bb);
      blossomparent.delete(bb);
      blossombase.delete(bb);
      blossomdual.delete(bb);
    }
    // 显式 .next() 驱动：不能用 for...of + break，否则 break 会对挂起的
    // 父生成器调用 return() 将其提前关闭（Python 的 for+break 无此语义）。
    const stack: Generator<Blossom>[] = [recurse(b, endstage)];
    while (stack.length) {
      const r = stack[stack.length - 1].next();
      if (r.done) stack.pop();
      else stack.push(recurse(r.value, endstage));
    }
  }

  function augmentBlossom(b: Blossom, v: number): void {
    function* recurse(bb: Blossom, vv: number): Generator<[Blossom, number]> {
      let t: BO = vv;
      while (blossomparent.get(t as Blossom) !== bb) {
        t = blossomparent.get(t as Blossom)!;
      }
      if (isBlossom(t)) yield [t, vv];
      let i = bb.childs.indexOf(t);
      let j = i;
      let jstep: number;
      if (i & 1) {
        j -= bb.childs.length;
        jstep = 1;
      } else {
        jstep = -1;
      }
      const L = bb.childs.length;
      const at = (x: number): BO => bb.childs[((x % L) + L) % L];
      const eAt = (x: number): [number, number] => bb.edges[((x % L) + L) % L];
      while (j !== 0) {
        j += jstep;
        t = at(j);
        let w: number, x: number;
        if (jstep === 1) [w, x] = eAt(j);
        else [x, w] = eAt(j - 1);
        if (isBlossom(t)) yield [t, w];
        j += jstep;
        t = at(j);
        if (isBlossom(t)) yield [t, x];
        mate[w] = x;
        mate[x] = w;
      }
      bb.childs = bb.childs.slice(i).concat(bb.childs.slice(0, i));
      bb.edges = bb.edges.slice(i).concat(bb.edges.slice(0, i));
      blossombase.set(bb, blossombase.get(bb.childs[0])!);
      if (blossombase.get(bb) !== vv) throw new Error('blossom 不变量被破坏：增广后基顶点错误');
    }
    // 同上：显式 .next() 驱动，避免 for...of 提前关闭父生成器。
    const stack: Generator<[Blossom, number]>[] = [recurse(b, v)];
    while (stack.length) {
      const r = stack[stack.length - 1].next();
      if (r.done) stack.pop();
      else stack.push(recurse(r.value[0], r.value[1]));
    }
  }

  function augmentMatching(vIn: number, wIn: number): void {
    for (const [s0, j0] of [[vIn, wIn], [wIn, vIn]] as [number, number][]) {
      let s = s0;
      let j = j0;
      for (;;) {
        const bs = inblossom[s];
        if (label.get(bs) !== 1) throw new Error('blossom 不变量被破坏：增广路顶点非 S');
        if (isBlossom(bs)) augmentBlossom(bs, s);
        mate[s] = j;
        const le = labeledge.get(bs) ?? null;
        if (le === null) break;
        const t = le[0];
        const bt = inblossom[t];
        if (label.get(bt) !== 2) throw new Error('blossom 不变量被破坏：增广路顶点非 T');
        [s, j] = labeledge.get(bt)!;
        if (isBlossom(bt)) augmentBlossom(bt, j);
        mate[j] = s;
      }
    }
  }

  // 主循环：每阶段找一条增广路改进匹配。
  for (;;) {
    label.clear();
    labeledge.clear();
    bestedge.clear();
    for (const b of blossomdual) b[0].mybestedges = null;
    allowedge.clear();
    queue.length = 0;

    for (let v = 0; v < n; v++) {
      if (mate[v] === -1 && label.get(inblossom[v]) === undefined) {
        assignLabel(v, 1, null);
      }
    }

    let augmented = false;
    for (;;) {
      while (queue.length && !augmented) {
        const v = queue.pop()!;
        if (label.get(inblossom[v]) !== 1) continue;
        for (const w of adj[v]) {
          if (w === v) continue;
          const bv = inblossom[v];
          const bw = inblossom[w];
          if (bv === bw) continue;
          let kslack = 0n;
          if (!allowedge.has(enc(v, w))) {
            kslack = slack(v, w);
            if (kslack <= 0n) {
              allowedge.add(enc(v, w));
              allowedge.add(enc(w, v));
            }
          }
          if (allowedge.has(enc(v, w))) {
            if (label.get(bw) === undefined) {
              assignLabel(w, 2, v);
            } else if (label.get(bw) === 1) {
              const base = scanBlossom(v, w);
              if (base !== NO_NODE) {
                addBlossom(base, v, w);
              } else {
                augmentMatching(v, w);
                augmented = true;
                break;
              }
            } else if (label.get(w) === undefined) {
              if (label.get(bw) !== 2) throw new Error('blossom 不变量被破坏：内部顶点所在花非 T');
              label.set(w, 2);
              labeledge.set(w, [v, w]);
            }
          } else if (label.get(bw) === 1) {
            const be = bestedge.get(bv);
            if (be === null || be === undefined || kslack < slack(be[0], be[1])) {
              bestedge.set(bv, [v, w]);
            }
          } else if (label.get(w) === undefined) {
            const be = bestedge.get(w);
            if (be === null || be === undefined || kslack < slack(be[0], be[1])) {
              bestedge.set(w, [v, w]);
            }
          }
        }
      }
      if (augmented) break;

      let deltatype = -1;
      let delta = 0n;
      let deltaedge: [number, number] | null = null;
      let deltablossom: Blossom | null = null;

      // delta2：S 顶点到自由顶点的最小松弛边。
      for (let v = 0; v < n; v++) {
        if (label.get(inblossom[v]) === undefined) {
          const be = bestedge.get(v);
          if (be !== null && be !== undefined) {
            const d = slack(be[0], be[1]);
            if (deltatype === -1 || d < delta) {
              delta = d;
              deltatype = 2;
              deltaedge = be;
            }
          }
        }
      }
      // delta3：两个 S 花之间最小松弛边的一半。
      for (const b of blossomparent.keys()) {
        if (blossomparent.get(b) === null && label.get(b) === 1) {
          const be = bestedge.get(b);
          if (be !== null && be !== undefined) {
            const ks = slack(be[0], be[1]);
            if (ks % 2n !== 0n) throw new Error('整数权重下边的 2*slack 应为偶数');
            const d = ks / 2n;
            if (deltatype === -1 || d < delta) {
              delta = d;
              deltatype = 3;
              deltaedge = be;
            }
          }
        }
      }
      // delta4：T 花的最小花对偶。
      for (const b of blossomdual.keys()) {
        if (blossomparent.get(b) === null && label.get(b) === 2) {
          const z = blossomdual.get(b)!;
          if (deltatype === -1 || z < delta) {
            delta = z;
            deltatype = 4;
            deltablossom = b;
          }
        }
      }

      if (deltatype === -1) {
        // 无可调整对偶：最大基数匹配已达到。完美则终局结束，否则图无完美匹配。
        let perfect = true;
        for (let v = 0; v < n; v++) if (mate[v] === -1) perfect = false;
        if (perfect) break;
        throw new Error('图不存在完美匹配：无增广路且无可行对偶调整');
      }

      for (let v = 0; v < n; v++) {
        const lb = label.get(inblossom[v]);
        if (lb === 1) dualvar[v] -= delta;
        else if (lb === 2) dualvar[v] += delta;
      }
      for (const b of blossomdual.keys()) {
        if (blossomparent.get(b) === null) {
          const lb = label.get(b);
          if (lb === 1) blossomdual.set(b, blossomdual.get(b)! + delta);
          else if (lb === 2) blossomdual.set(b, blossomdual.get(b)! - delta);
        }
      }

      if (deltatype === 2 || deltatype === 3) {
        const [v, w] = deltaedge!;
        allowedge.add(enc(v, w));
        allowedge.add(enc(w, v));
        if (label.get(inblossom[v]) !== 1) throw new Error('blossom 不变量被破坏：delta 边端点非 S');
        queue.push(v);
      } else if (deltatype === 4) {
        expandBlossom(deltablossom!, false);
      } else {
        throw new Error('blossom 不变量被破坏：意外的 delta 类型');
      }
    }

    for (let v = 0; v < n; v++) {
      if (mate[v] !== -1 && mate[mate[v]] !== v) {
        throw new Error('blossom 不变量被破坏：匹配不对称');
      }
    }
    if (!augmented) break;

    for (const b of [...blossomdual.keys()]) {
      if (!blossomdual.has(b)) continue;
      if (blossomparent.get(b) === null && label.get(b) === 1 && blossomdual.get(b) === 0n) {
        expandBlossom(b, true);
      }
    }
  }
  return mate;
}

export interface Edge {
  u: number;
  v: number;
  /** 非负整数权重（越大越优先） */
  w: bigint;
}

/**
 * 一般图最小权完美匹配。
 * 采用 NetworkX 同款变换：w' = (maxW + 1) - w，再求最大权完美匹配。
 * 仅需传入完美匹配可能用到的边；返回顶点配对列表（每对 u<v）。
 */
export function minWeightPerfectMatching(edgeList: Edge[], n: number): [number, number][] {
  if (n % 2 !== 0) throw new Error('顶点数为奇数，不存在完美匹配');
  if (n === 0) return [];
  let maxW = 0n;
  for (const e of edgeList) if (e.w > maxW) maxW = e.w;
  const offset = maxW + 1n;
  const matrix = new Map<string, bigint>();
  const adj: number[][] = Array.from({ length: n }, () => []);
  const key = (u: number, v: number): string => (u < v ? `${u}|${v}` : `${v}|${u}`);
  for (const e of edgeList) {
    if (e.u === e.v) continue;
    const k = key(e.u, e.v);
    if (!matrix.has(k)) {
      adj[e.u].push(e.v);
      adj[e.v].push(e.u);
    }
    // 平行边取最大变换权重 = 最小原始权重。
    const prev = matrix.get(k);
    const tw = offset - e.w;
    if (prev === undefined || tw > prev) matrix.set(k, tw);
  }
  for (let v = 0; v < n; v++) adj[v].sort((a, b) => a - b);
  const G: WeightedGraph = {
    n,
    adj,
    weight(u, v) {
      const w = matrix.get(key(u, v));
      if (w === undefined) throw new Error(`查询了不存在的边 ${u}-${v}`);
      return w;
    }
  };
  const mate = maxWeightMatching(G);
  const pairs: [number, number][] = [];
  for (let v = 0; v < n; v++) {
    if (mate[v] > v) pairs.push([v, mate[v]]);
  }
  return pairs;
}
