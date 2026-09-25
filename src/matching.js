/*
 * 一般图最小权完美匹配（Edmonds 开花算法 + 原始-对偶方法）。
 *
 * 本文件是 NetworkX max_weight_matching 的忠实 JavaScript 移植
 * （算法出自 Zvi Galil, "Efficient Algorithms for Finding Maximum
 * Matching in Graphs", ACM Computing Surveys, 1986；参考实现为
 * Joris van Rantwijk 的 Python 版本）。
 *
 * 所有边权为整数时，全部计算均为精确整数运算（对偶变量按 2 倍存储）。
 *
 * 同时兼容浏览器 Web Worker（挂到全局 Matching）与 Node.js（module.exports）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.Matching = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // 非平凡开花（blossom）节点。平凡开花直接用顶点编号（number）表示。
  class Blossom {
    constructor() {
      // childs: 子开花有序列表，从基顶点开始沿开花排列
      this.childs = [];
      // edges: edges[i] = (v, w)，v 属于 childs[i]，w 属于 childs[i+1 mod n]
      this.edges = [];
      // 顶层 S 开花的候选最松边列表（用于 delta3 加速），未计算为 null
      this.mybestedges = null;
    }
    *leaves() {
      const stack = this.childs.slice();
      while (stack.length) {
        const t = stack.pop();
        if (t instanceof Blossom) {
          for (const c of t.childs) stack.push(c);
        } else {
          yield t;
        }
      }
    }
  }

  function assert(cond, msg) {
    if (!cond) {
      throw new Error('matching assertion failed: ' + (msg || ''));
    }
  }

  /*
   * 最大权匹配（maxcardinality=true 时为最大基数下的最大权匹配）。
   * n: 顶点数，顶点编号 0..n-1
   * edges: [[v, w, weight], ...]
   * 返回 Map mate（v -> 配对顶点）。
   */
  function maxWeightMatching(n, edges, maxcardinality) {
    if (maxcardinality === undefined) maxcardinality = false;
    const NoNode = {}; // 唯一哨兵，区别于任何顶点
    const gnodes = [];
    for (let i = 0; i < n; i++) gnodes.push(i);
    if (n === 0) return new Map();

    // 邻接表与边权表
    const adj = new Map();
    const wt = new Map();
    for (const v of gnodes) adj.set(v, []);
    let maxweight = 0;
    let allinteger = true;
    const edgeList = [];
    for (const e of edges) {
      const i = e[0], j = e[1], w = e[2];
      if (i === j) continue; // 忽略自环
      edgeList.push([i, j, w]);
      adj.get(i).push(j);
      adj.get(j).push(i);
      wt.set(i + ',' + j, w);
      wt.set(j + ',' + i, w);
      if (w > maxweight) maxweight = w;
      if (!Number.isInteger(w)) allinteger = false;
    }

    const mate = new Map(); // 已匹配顶点 -> 配偶
    const label = new Map(); // 顶层开花 -> 1(S) / 2(T)；缺失或 null 为未标号
    const labeledge = new Map(); // 获得标号所经过的边 [v, w]
    const inblossom = new Map(); // 顶点 -> 其所在顶层开花
    const blossomparent = new Map(); // 子开花 -> 父开花；顶层为 null
    const blossombase = new Map(); // 开花 -> 基顶点
    const bestedge = new Map(); // 最松边记录（delta2/delta3 用）
    const dualvar = new Map(); // 顶点对偶变量的 2 倍
    const blossomdual = new Map(); // 非平凡开花的对偶变量
    const allowedge = new Set(); // 已知零松弛的边 "v,w"
    const queue = []; // 新发现的 S 顶点队列

    for (const v of gnodes) {
      inblossom.set(v, v);
      blossomparent.set(v, null);
      blossombase.set(v, v);
      dualvar.set(v, maxweight);
    }

    // 边 (v, w) 松弛的 2 倍
    function slack(v, w) {
      return dualvar.get(v) + dualvar.get(w) - 2 * wt.get(v + ',' + w);
    }

    // 给含 w 的顶层开花标号 t（来自顶点 v 的边）
    function assignLabel(w, t, v) {
      const b = inblossom.get(w);
      assert(label.get(w) == null && label.get(b) == null, 'assignLabel');
      label.set(w, t);
      label.set(b, t);
      if (v !== null) {
        labeledge.set(w, [v, w]);
        labeledge.set(b, [v, w]);
      } else {
        labeledge.set(w, null);
        labeledge.set(b, null);
      }
      bestedge.set(w, null);
      bestedge.set(b, null);
      if (t === 1) {
        // b 成为 S 开花，其全部叶子顶点入队
        if (b instanceof Blossom) {
          for (const leaf of b.leaves()) queue.push(leaf);
        } else {
          queue.push(b);
        }
      } else if (t === 2) {
        // b 成为 T 开花，给其基顶点的配偶标 S
        const base = blossombase.get(b);
        assignLabel(mate.get(base), 1, base);
      }
    }

    // 从 v、w 回溯，发现新开花（返回基顶点）或增广路（返回 NoNode）
    function scanBlossom(v, w) {
      const path = [];
      let base = NoNode;
      while (v !== NoNode) {
        let b = inblossom.get(v);
        if ((label.get(b) & 4) !== 0) {
          base = blossombase.get(b);
          break;
        }
        assert(label.get(b) === 1, 'scanBlossom S');
        path.push(b);
        label.set(b, 5); // 面包屑：1 | 4
        if (labeledge.get(b) == null) {
          assert(!mate.has(blossombase.get(b)), 'scanBlossom single');
          v = NoNode;
        } else {
          assert(labeledge.get(b)[0] === mate.get(blossombase.get(b)), 'scanBlossom mate');
          v = labeledge.get(b)[0];
          b = inblossom.get(v);
          assert(label.get(b) === 2, 'scanBlossom T');
          v = labeledge.get(b)[0];
        }
        if (w !== NoNode) {
          const t = v;
          v = w;
          w = t;
        }
      }
      for (const b of path) label.set(b, 1);
      return base;
    }

    // 以 base 为基、经 S 顶点 v 与 w 构造新开花
    function addBlossom(base, v, w) {
      const bb = inblossom.get(base);
      let bv = inblossom.get(v);
      let bw = inblossom.get(w);
      const b = new Blossom();
      blossombase.set(b, base);
      blossomparent.set(b, null);
      blossomparent.set(bb, b);
      const path = [];
      const edgs = [[v, w]];
      b.childs = path;
      b.edges = edgs;
      // 从 v 回溯到基
      let vv = v;
      while (bv !== bb) {
        blossomparent.set(bv, b);
        path.push(bv);
        edgs.push(labeledge.get(bv));
        assert(
          label.get(bv) === 2 ||
            (label.get(bv) === 1 && labeledge.get(bv)[0] === mate.get(blossombase.get(bv))),
          'addBlossom v'
        );
        vv = labeledge.get(bv)[0];
        bv = inblossom.get(vv);
      }
      path.push(bb);
      path.reverse();
      edgs.reverse();
      // 从 w 回溯到基
      let ww = w;
      while (bw !== bb) {
        blossomparent.set(bw, b);
        path.push(bw);
        const le = labeledge.get(bw);
        edgs.push([le[1], le[0]]);
        assert(
          label.get(bw) === 2 ||
            (label.get(bw) === 1 && le[0] === mate.get(blossombase.get(bw))),
          'addBlossom w'
        );
        ww = le[0];
        bw = inblossom.get(ww);
      }
      assert(label.get(bb) === 1, 'addBlossom base');
      label.set(b, 1);
      labeledge.set(b, labeledge.get(bb));
      blossomdual.set(b, 0);
      // 原 T 顶点变为 S 顶点，入队
      for (const leaf of b.leaves()) {
        if (label.get(inblossom.get(leaf)) === 2) queue.push(leaf);
        inblossom.set(leaf, b);
      }
      // 计算 b.mybestedges
      const bestedgeto = new Map();
      for (const bvv of path) {
        let nblist;
        if (bvv instanceof Blossom) {
          if (bvv.mybestedges !== null) {
            nblist = bvv.mybestedges;
            bvv.mybestedges = null;
          } else {
            nblist = [];
            for (const leaf of bvv.leaves()) {
              for (const w2 of adj.get(leaf)) {
                if (leaf !== w2) nblist.push([leaf, w2]);
              }
            }
          }
        } else {
          nblist = [];
          for (const w2 of adj.get(bvv)) {
            if (bvv !== w2) nblist.push([bvv, w2]);
          }
        }
        for (const k of nblist) {
          let i = k[0], j = k[1];
          if (inblossom.get(j) === b) {
            const t = i;
            i = j;
            j = t;
          }
          const bj = inblossom.get(j);
          if (
            bj !== b &&
            label.get(bj) === 1 &&
            (!bestedgeto.has(bj) || slack(i, j) < slack(bestedgeto.get(bj)[0], bestedgeto.get(bj)[1]))
          ) {
            bestedgeto.set(bj, k);
          }
        }
        bestedge.set(bvv, null);
      }
      b.mybestedges = Array.from(bestedgeto.values());
      let mybestedge = null;
      let mybestslack = 0;
      bestedge.set(b, null);
      for (const k of b.mybestedges) {
        const kslack = slack(k[0], k[1]);
        if (mybestedge === null || kslack < mybestslack) {
          mybestedge = k;
          mybestslack = kslack;
        }
      }
      bestedge.set(b, mybestedge);
    }

    // 展开顶层开花 b（递归深度受开花嵌套层数限制，远小于顶点数）
    function expandBlossom(b, endstage) {
      for (const s of b.childs) {
        blossomparent.set(s, null);
        if (s instanceof Blossom) {
          if (endstage && blossomdual.get(s) === 0) {
            expandBlossom(s, endstage);
          } else {
            for (const leaf of s.leaves()) inblossom.set(leaf, s);
          }
        } else {
          inblossom.set(s, s);
        }
      }
      if (!endstage && label.get(b) === 2) {
        // 展开 T 开花时需重新标号子开花
        const entrychild = inblossom.get(labeledge.get(b)[1]);
        const L = b.childs.length;
        const idx = (k) => ((k % L) + L) % L; // Python 负下标语义
        let j = b.childs.indexOf(entrychild);
        let jstep;
        if (j & 1) {
          j -= L;
          jstep = 1;
        } else {
          jstep = -1;
        }
        let vw = labeledge.get(b);
        let v = vw[0], w = vw[1];
        while (j !== 0) {
          let p, q;
          if (jstep === 1) {
            p = b.edges[idx(j)][0];
            q = b.edges[idx(j)][1];
          } else {
            q = b.edges[idx(j - 1)][0];
            p = b.edges[idx(j - 1)][1];
          }
          label.set(w, null);
          label.set(q, null);
          assignLabel(w, 2, v);
          allowedge.add(p + ',' + q);
          allowedge.add(q + ',' + p);
          j += jstep;
          if (jstep === 1) {
            v = b.edges[idx(j)][0];
            w = b.edges[idx(j)][1];
          } else {
            w = b.edges[idx(j - 1)][0];
            v = b.edges[idx(j - 1)][1];
          }
          allowedge.add(v + ',' + w);
          allowedge.add(w + ',' + v);
          j += jstep;
        }
        // 基部 T 子开花重新标号（不经过其配偶）
        const bw = b.childs[idx(j)];
        label.set(w, 2);
        label.set(bw, 2);
        labeledge.set(w, [v, w]);
        labeledge.set(bw, [v, w]);
        bestedge.set(bw, null);
        j += jstep;
        while (b.childs[idx(j)] !== entrychild) {
          const bv = b.childs[idx(j)];
          if (label.get(bv) === 1) {
            j += jstep;
            continue;
          }
          let v2;
          if (bv instanceof Blossom) {
            for (const leaf of bv.leaves()) {
              v2 = leaf;
              if (label.get(leaf) != null) break;
            }
          } else {
            v2 = bv;
          }
          if (v2 !== undefined && label.get(v2) != null) {
            assert(label.get(v2) === 2, 'expandBlossom relabel');
            assert(inblossom.get(v2) === bv, 'expandBlossom inblossom');
            label.set(v2, null);
            label.set(mate.get(blossombase.get(bv)), null);
            assignLabel(v2, 2, labeledge.get(v2)[0]);
          }
          j += jstep;
        }
      }
      label.delete(b);
      labeledge.delete(b);
      bestedge.delete(b);
      blossomparent.delete(b);
      blossombase.delete(b);
      blossomdual.delete(b);
    }

    // 沿开花 b 内 v 到基顶点的交错路交换匹配/未匹配边
    function augmentBlossom(b, v) {
      let t = v;
      while (blossomparent.get(t) !== b) t = blossomparent.get(t);
      if (t instanceof Blossom) augmentBlossom(t, v);
      const L = b.childs.length;
      const idx = (k) => ((k % L) + L) % L;
      const i = b.childs.indexOf(t);
      let j = i;
      let jstep;
      if (i & 1) {
        j -= L;
        jstep = 1;
      } else {
        jstep = -1;
      }
      while (j !== 0) {
        j += jstep;
        let t1 = b.childs[idx(j)];
        let w, x;
        if (jstep === 1) {
          w = b.edges[idx(j)][0];
          x = b.edges[idx(j)][1];
        } else {
          x = b.edges[idx(j - 1)][0];
          w = b.edges[idx(j - 1)][1];
        }
        if (t1 instanceof Blossom) augmentBlossom(t1, w);
        j += jstep;
        t1 = b.childs[idx(j)];
        if (t1 instanceof Blossom) augmentBlossom(t1, x);
        mate.set(w, x);
        mate.set(x, w);
      }
      // 旋转子开花列表，使新基位于首位
      b.childs = b.childs.slice(i).concat(b.childs.slice(0, i));
      b.edges = b.edges.slice(i).concat(b.edges.slice(0, i));
      blossombase.set(b, blossombase.get(b.childs[0]));
      assert(blossombase.get(b) === v, 'augmentBlossom base');
    }

    // 沿两个单顶点间的增广路交换匹配状态
    function augmentMatching(v, w) {
      const pairs = [
        [v, w],
        [w, v],
      ];
      for (const pr of pairs) {
        let s = pr[0], j = pr[1];
        while (true) {
          const bs = inblossom.get(s);
          assert(label.get(bs) === 1, 'augmentMatching S');
          assert(
            (labeledge.get(bs) == null && !mate.has(blossombase.get(bs))) ||
              labeledge.get(bs)[0] === mate.get(blossombase.get(bs)),
            'augmentMatching label'
          );
          if (bs instanceof Blossom) augmentBlossom(bs, s);
          mate.set(s, j);
          if (labeledge.get(bs) == null) break;
          const t = labeledge.get(bs)[0];
          const bt = inblossom.get(t);
          assert(label.get(bt) === 2, 'augmentMatching T');
          const le = labeledge.get(bt);
          s = le[0];
          j = le[1];
          assert(blossombase.get(bt) === t, 'augmentMatching base');
          if (bt instanceof Blossom) augmentBlossom(bt, j);
          mate.set(j, s);
        }
      }
    }

    // 校验已达最优（仅整数权重时调用）
    function verifyOptimum() {
      let vdualoffset = 0;
      if (maxcardinality) {
        let mind = Infinity;
        for (const v of gnodes) mind = Math.min(mind, dualvar.get(v));
        vdualoffset = Math.max(0, -mind);
      }
      let mindual = Infinity;
      for (const v of gnodes) mindual = Math.min(mindual, dualvar.get(v));
      assert(mindual + vdualoffset >= 0, 'vo: dual nonnegative');
      if (blossomdual.size) {
        let minb = Infinity;
        for (const z of blossomdual.values()) minb = Math.min(minb, z);
        assert(minb >= 0, 'vo: blossom dual nonnegative');
      }
      for (const e of edgeList) {
        const i = e[0], j = e[1], weight = e[2];
        if (i === j) continue;
        let s = dualvar.get(i) + dualvar.get(j) - 2 * weight;
        const ib = [i];
        const jb = [j];
        while (blossomparent.get(ib[ib.length - 1]) != null) {
          ib.push(blossomparent.get(ib[ib.length - 1]));
        }
        while (blossomparent.get(jb[jb.length - 1]) != null) {
          jb.push(blossomparent.get(jb[jb.length - 1]));
        }
        ib.reverse();
        jb.reverse();
        const m = Math.min(ib.length, jb.length);
        for (let k = 0; k < m; k++) {
          if (ib[k] !== jb[k]) break;
          const z = blossomdual.get(ib[k]);
          assert(z !== undefined, 'vo: blossom dual exists');
          s += 2 * z;
        }
        assert(s >= 0, 'vo: slack nonnegative');
        if (mate.get(i) === j || mate.get(j) === i) {
          assert(mate.get(i) === j && mate.get(j) === i, 'vo: mate symmetric');
          assert(s === 0, 'vo: matched edge zero slack');
        }
      }
      for (const v of gnodes) {
        assert(mate.has(v) || dualvar.get(v) + vdualoffset === 0, 'vo: single zero dual');
      }
      for (const entry of blossomdual) {
        const b = entry[0], z = entry[1];
        if (z > 0) {
          assert(b.edges.length % 2 === 1, 'vo: blossom full');
          for (let k = 1; k < b.edges.length; k += 2) {
            const i = b.edges[k][0], j = b.edges[k][1];
            assert(mate.get(i) === j && mate.get(j) === i, 'vo: blossom full mate');
          }
        }
      }
    }

    // 主循环：每个阶段寻找一条增广路
    while (true) {
      label.clear();
      labeledge.clear();
      bestedge.clear();
      for (const b of blossomdual.keys()) b.mybestedges = null;
      allowedge.clear();
      queue.length = 0;

      // 所有单顶点标 S 入队
      for (const v of gnodes) {
        if (!mate.has(v) && label.get(inblossom.get(v)) == null) {
          assignLabel(v, 1, null);
        }
      }

      let augmented = 0;
      while (true) {
        // 子阶段：标号直到找不到增广路，然后按原始-对偶方法调整对偶变量
        while (queue.length && !augmented) {
          const v = queue.pop();
          assert(label.get(inblossom.get(v)) === 1, 'queue S');
          for (const w of adj.get(v)) {
            if (w === v) continue;
            const bv = inblossom.get(v);
            const bw = inblossom.get(w);
            if (bv === bw) continue; // 开花内部边
            let kslack = 0;
            const key = v + ',' + w;
            if (!allowedge.has(key)) {
              kslack = slack(v, w);
              if (kslack <= 0) {
                allowedge.add(key);
                allowedge.add(w + ',' + v);
              }
            }
            if (allowedge.has(key)) {
              if (label.get(bw) == null) {
                // (C1) w 自由：标 T，其配偶标 S
                assignLabel(w, 2, v);
              } else if (label.get(bw) === 1) {
                // (C2) w 为 S：发现新开花或增广路
                const base = scanBlossom(v, w);
                if (base !== NoNode) {
                  addBlossom(base, v, w);
                } else {
                  augmentMatching(v, w);
                  augmented = 1;
                  break;
                }
              } else if (label.get(w) == null) {
                // w 在 T 开花内部且尚未从外部到达
                assert(label.get(bw) === 2, 'inside T');
                label.set(w, 2);
                labeledge.set(w, [v, w]);
              }
            } else if (label.get(bw) === 1) {
              // 记录到另一 S 开花的最松非允许边
              const be = bestedge.get(bv);
              if (be == null || kslack < slack(be[0], be[1])) {
                bestedge.set(bv, [v, w]);
              }
            } else if (label.get(w) == null) {
              // 记录到达 w 的最松边
              const be = bestedge.get(w);
              if (be == null || kslack < slack(be[0], be[1])) {
                bestedge.set(w, [v, w]);
              }
            }
          }
        }
        if (augmented) break;

        // 计算 delta 并更新对偶变量
        let deltatype = -1;
        let delta = 0;
        let deltaedge = null;
        let deltablossom = null;

        // delta1：最小顶点对偶（仅非最大基数模式）
        if (!maxcardinality) {
          deltatype = 1;
          delta = Infinity;
          for (const v of gnodes) delta = Math.min(delta, dualvar.get(v));
        }

        // delta2：S 顶点与自由顶点间最小松弛
        for (const v of gnodes) {
          if (label.get(inblossom.get(v)) == null && bestedge.get(v) != null) {
            const be = bestedge.get(v);
            const d = slack(be[0], be[1]);
            if (deltatype === -1 || d < delta) {
              delta = d;
              deltatype = 2;
              deltaedge = be;
            }
          }
        }

        // delta3：两个 S 开花间最小松弛的一半
        for (const b of blossomparent.keys()) {
          if (blossomparent.get(b) === null && label.get(b) === 1 && bestedge.get(b) != null) {
            const be = bestedge.get(b);
            const kslack = slack(be[0], be[1]);
            let d;
            if (allinteger) {
              assert(kslack % 2 === 0, 'delta3 even');
              d = kslack / 2;
            } else {
              d = kslack / 2;
            }
            if (deltatype === -1 || d < delta) {
              delta = d;
              deltatype = 3;
              deltaedge = be;
            }
          }
        }

        // delta4：T 开花的最小 z 值
        for (const entry of blossomdual) {
          const b = entry[0], z = entry[1];
          if (
            blossomparent.get(b) === null &&
            label.get(b) === 2 &&
            (deltatype === -1 || z < delta)
          ) {
            delta = z;
            deltatype = 4;
            deltablossom = b;
          }
        }

        if (deltatype === -1) {
          // 无法继续改进：最大基数最优
          assert(maxcardinality, 'deltatype -1 requires maxcardinality');
          deltatype = 1;
          let mind = Infinity;
          for (const v of gnodes) mind = Math.min(mind, dualvar.get(v));
          delta = Math.max(0, mind);
        }

        // 按 delta 更新对偶变量
        for (const v of gnodes) {
          const l = label.get(inblossom.get(v));
          if (l === 1) dualvar.set(v, dualvar.get(v) - delta);
          else if (l === 2) dualvar.set(v, dualvar.get(v) + delta);
        }
        for (const entry of blossomdual) {
          const b = entry[0];
          if (blossomparent.get(b) === null) {
            const l = label.get(b);
            if (l === 1) blossomdual.set(b, blossomdual.get(b) + delta);
            else if (l === 2) blossomdual.set(b, blossomdual.get(b) - delta);
          }
        }

        if (deltatype === 1) {
          break; // 最优
        } else if (deltatype === 2) {
          const v = deltaedge[0], w = deltaedge[1];
          assert(label.get(inblossom.get(v)) === 1, 'delta2 S');
          allowedge.add(v + ',' + w);
          allowedge.add(w + ',' + v);
          queue.push(v);
        } else if (deltatype === 3) {
          const v = deltaedge[0], w = deltaedge[1];
          allowedge.add(v + ',' + w);
          allowedge.add(w + ',' + v);
          assert(label.get(inblossom.get(v)) === 1, 'delta3 S');
          queue.push(v);
        } else if (deltatype === 4) {
          expandBlossom(deltablossom, false);
        }
      }

      // 匹配对称性检查
      for (const entry of mate) {
        assert(mate.get(entry[1]) === entry[0], 'mate symmetric');
      }

      if (!augmented) break;

      // 阶段结束：展开对偶为零的 S 开花
      for (const b of Array.from(blossomdual.keys())) {
        if (!blossomdual.has(b)) continue;
        if (blossomparent.get(b) === null && label.get(b) === 1 && blossomdual.get(b) === 0) {
          expandBlossom(b, true);
        }
      }
    }

    if (allinteger) verifyOptimum();
    return mate;
  }

  /*
   * 最小权完美匹配。
   * n: 顶点数（须为偶数）；edges: [[v, w, 整数权重], ...]
   * 返回 { cost, pairs: [[v, w], ...] }；不存在完美匹配时返回 null。
   * 变换方式与 NetworkX min_weight_matching 相同：
   * w' = (maxW + 1) - w，再求最大基数最大权匹配。
   */
  function minWeightPerfectMatching(n, edges) {
    if (n % 2 === 1) return null;
    if (n === 0) return { cost: 0, pairs: [] };
    const ne = [];
    for (const e of edges) {
      if (e[0] !== e[1]) ne.push(e);
    }
    if (ne.length === 0) return null;
    let maxW = -Infinity;
    for (const e of ne) if (e[2] > maxW) maxW = e[2];
    const K = maxW + 1;
    const tedges = ne.map((e) => [e[0], e[1], K - e[2]]);
    const mate = maxWeightMatching(n, tedges, true);
    if (mate.size !== n) return null; // 不存在完美匹配
    const wmap = new Map();
    for (const e of ne) {
      const k = e[0] < e[1] ? e[0] + ',' + e[1] : e[1] + ',' + e[0];
      if (!wmap.has(k) || e[2] < wmap.get(k)) wmap.set(k, e[2]);
    }
    const seen = new Set();
    const pairs = [];
    let cost = 0;
    for (const entry of mate) {
      const v = entry[0], w = entry[1];
      const k = v < w ? v + ',' + w : w + ',' + v;
      if (seen.has(k)) continue;
      seen.add(k);
      pairs.push([v, w]);
      cost += wmap.get(k);
    }
    return { cost: cost, pairs: pairs };
  }

  return {
    maxWeightMatching: maxWeightMatching,
    minWeightPerfectMatching: minWeightPerfectMatching,
  };
});
