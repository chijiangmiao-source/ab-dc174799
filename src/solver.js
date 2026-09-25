/*
 * 纠错链求解器：矩形码格 + 整数边代价 + 边界 + 检测事件
 *   → 每事件 Dijkstra 最短路
 *   → 归约为一般图最小权完美匹配（事件节点 + 每事件一个虚拟边界节点）
 *   → 同成本时按“事件录入顺序逐项比较：边界优先、随后另一端标识升序”
 *     的链向量做规范化（通过约束重求解取字典序最小）
 *   → 重建每条链的逐边路径与代价
 *
 * 同时兼容浏览器（全局 Solver，依赖全局 Matching）与 Node.js。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./matching.js'));
  } else {
    root.Solver = factory(root.Matching);
  }
})(typeof self !== 'undefined' ? self : globalThis, function (Matching) {
  'use strict';

  const MAX_EVENTS = 48;
  const MIN_EVENTS = 2;
  const MAX_DIM = 60;

  function cellName(cell) {
    return '(' + cell[0] + ',' + cell[1] + ')';
  }

  function edgeName(e) {
    return cellName(e[0]) + '—' + cellName(e[1]);
  }

  /*
   * 输入校验。返回错误数组，每个错误含 code、message 与定位信息 at。
   * at 形如 {cell:[r,c]} / {edge:[[r,c],[r,c]]} / {event:i} / {boundary:i} / {events:[i..]}
   */
  function validate(spec) {
    const errors = [];
    if (!spec || typeof spec !== 'object') {
      return [{ code: 'spec', message: '规格为空或不是对象' }];
    }
    const rows = spec.rows;
    const cols = spec.cols;
    if (
      !Number.isInteger(rows) ||
      !Number.isInteger(cols) ||
      rows < 1 ||
      cols < 1 ||
      rows > MAX_DIM ||
      cols > MAX_DIM
    ) {
      errors.push({
        code: 'grid-size',
        message: '网格行列须为 1..' + MAX_DIM + ' 的整数，收到 ' + rows + '×' + cols,
      });
      return errors;
    }
    // 边代价：缺失按 1 处理；出现的必须为正整数
    const hCosts = spec.hCosts;
    const vCosts = spec.vCosts;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const raw = hCosts && hCosts[r] ? hCosts[r][c] : undefined;
        const val = raw === undefined || raw === null ? 1 : raw;
        if (!Number.isInteger(val) || val <= 0) {
          errors.push({
            code: 'edge-cost',
            message: '边 ' + edgeName([[r, c], [r, c + 1]]) + ' 的代价须为正整数，收到 ' + JSON.stringify(raw),
            at: { edge: [[r, c], [r, c + 1]] },
          });
        }
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols; c++) {
        const raw = vCosts && vCosts[r] ? vCosts[r][c] : undefined;
        const val = raw === undefined || raw === null ? 1 : raw;
        if (!Number.isInteger(val) || val <= 0) {
          errors.push({
            code: 'edge-cost',
            message: '边 ' + edgeName([[r, c], [r + 1, c]]) + ' 的代价须为正整数，收到 ' + JSON.stringify(raw),
            at: { edge: [[r, c], [r + 1, c]] },
          });
        }
      }
    }
    // 检测事件
    const events = Array.isArray(spec.events) ? spec.events : [];
    if (events.length < MIN_EVENTS || events.length > MAX_EVENTS) {
      errors.push({
        code: 'event-count',
        message:
          '检测事件数量须为 ' + MIN_EVENTS + '..' + MAX_EVENTS + '，当前为 ' + events.length,
      });
    }
    const seenCell = new Map();
    events.forEach((ev, i) => {
      const r = Array.isArray(ev) ? ev[0] : undefined;
      const c = Array.isArray(ev) ? ev[1] : undefined;
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= rows || c >= cols) {
        errors.push({
          code: 'event-range',
          message: '事件 E' + (i + 1) + ' 坐标 ' + JSON.stringify(ev) + ' 越出 ' + rows + '×' + cols + ' 网格',
          at: { event: i },
        });
        return;
      }
      const k = r + ',' + c;
      if (seenCell.has(k)) {
        errors.push({
          code: 'event-dup',
          message:
            '事件 E' + (seenCell.get(k) + 1) + ' 与 E' + (i + 1) + ' 重复位于 ' + cellName([r, c]),
          at: { cell: [r, c], event: i },
        });
      } else {
        seenCell.set(k, i);
      }
    });
    // 边界
    const boundaries = Array.isArray(spec.boundaries) ? spec.boundaries : [];
    boundaries.forEach((b, i) => {
      const r = Array.isArray(b) ? b[0] : undefined;
      const c = Array.isArray(b) ? b[1] : undefined;
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= rows || c >= cols) {
        errors.push({
          code: 'boundary-range',
          message:
            '边界 B' + (i + 1) + ' 坐标 ' + JSON.stringify(b) + ' 越出 ' + rows + '×' + cols + ' 网格',
          at: { boundary: i },
        });
      }
    });
    if (errors.length) return errors;

    // 可达性：按连通区域检查“事件数为奇且无边界”的不可消去情形
    const N = rows * cols;
    const eventAt = new Map();
    events.forEach((ev, i) => eventAt.set(ev[0] * cols + ev[1], i));
    const boundSet = new Set(boundaries.map((b) => b[0] * cols + b[1]));
    const visited = new Array(N).fill(false);
    for (let s = 0; s < N; s++) {
      if (visited[s]) continue;
      const stack = [s];
      visited[s] = true;
      const compEvents = [];
      let compHasBoundary = false;
      while (stack.length) {
        const u = stack.pop();
        const r = Math.floor(u / cols);
        const c = u % cols;
        if (eventAt.has(u)) compEvents.push(eventAt.get(u));
        if (boundSet.has(u)) compHasBoundary = true;
        if (r > 0 && !visited[u - cols]) { visited[u - cols] = true; stack.push(u - cols); }
        if (r < rows - 1 && !visited[u + cols]) { visited[u + cols] = true; stack.push(u + cols); }
        if (c > 0 && !visited[u - 1]) { visited[u - 1] = true; stack.push(u - 1); }
        if (c < cols - 1 && !visited[u + 1]) { visited[u + 1] = true; stack.push(u + 1); }
      }
      if (compEvents.length % 2 === 1 && !compHasBoundary) {
        const desc = compEvents
          .slice()
          .sort((a, b) => a - b)
          .map((i) => 'E' + (i + 1) + cellName(events[i]))
          .join('、');
        errors.push({
          code: 'unreachable',
          message:
            '事件 ' + desc + ' 无可达终点：所在连通区域没有可用边界，且事件数为奇数（' +
            compEvents.length + '），无法全部两两配对',
          at: { events: compEvents.slice().sort((a, b) => a - b) },
        });
      }
    }
    return errors;
  }

  // 网格邻接表：节点 id = r*cols + c
  function buildAdj(spec) {
    const rows = spec.rows, cols = spec.cols;
    const N = rows * cols;
    const adj = new Array(N);
    for (let i = 0; i < N; i++) adj[i] = [];
    const h = spec.hCosts || [];
    const v = spec.vCosts || [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const u = r * cols + c;
        if (c + 1 < cols) {
          const raw = h[r] ? h[r][c] : undefined;
          const w = raw === undefined || raw === null ? 1 : raw;
          adj[u].push([u + 1, w]);
          adj[u + 1].push([u, w]);
        }
        if (r + 1 < rows) {
          const raw = v[r] ? v[r][c] : undefined;
          const w = raw === undefined || raw === null ? 1 : raw;
          adj[u].push([u + cols, w]);
          adj[u + cols].push([u, w]);
        }
      }
    }
    return adj;
  }

  // 单源 Dijkstra（二叉堆），返回 {dist, prev}；prev[src] = -1
  function dijkstra(N, adj, src) {
    const dist = new Array(N).fill(Infinity);
    const prev = new Array(N).fill(-1);
    dist[src] = 0;
    const heap = [[0, src]]; // [dist, node]，小顶堆
    const push = (item) => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        const t = heap[p];
        heap[p] = heap[i];
        heap[i] = t;
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          const t = heap[m];
          heap[m] = heap[i];
          heap[i] = t;
          i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const cur = pop();
      const d = cur[0], u = cur[1];
      if (d > dist[u]) continue;
      for (const e of adj[u]) {
        const w = e[0], c = e[1];
        const nd = d + c;
        if (nd < dist[w]) {
          dist[w] = nd;
          prev[w] = u;
          push([nd, w]);
        }
      }
    }
    return { dist: dist, prev: prev };
  }

  // 相邻两格间的边代价
  function gridEdgeCost(spec, a, b) {
    const r1 = a[0], c1 = a[1], r2 = b[0], c2 = b[1];
    if (r1 === r2) {
      const c = Math.min(c1, c2);
      const raw = spec.hCosts && spec.hCosts[r1] ? spec.hCosts[r1][c] : undefined;
      return raw === undefined || raw === null ? 1 : raw;
    }
    const r = Math.min(r1, r2);
    const raw = spec.vCosts && spec.vCosts[r] ? spec.vCosts[r][c1] : undefined;
    return raw === undefined || raw === null ? 1 : raw;
  }

  /*
   * 求解。返回：
   *   { ok:false, errors:[...] }
   *   或 { ok:true, totalCost, chains, assignments, diagnostics, events, boundaries }
   */
  function solve(spec) {
    const errors = validate(spec);
    if (errors.length) return { ok: false, errors: errors };

    const rows = spec.rows, cols = spec.cols;
    const events = spec.events.map((e) => [e[0], e[1]]);
    // 边界去重（保持录入顺序，下标即边界标识）
    const bseen = new Set();
    const boundaries = [];
    for (const b of spec.boundaries || []) {
      const k = b[0] + ',' + b[1];
      if (!bseen.has(k)) {
        bseen.add(k);
        boundaries.push([b[0], b[1]]);
      }
    }
    const n = events.length;
    const cellOf = (cell) => cell[0] * cols + cell[1];
    const adj = buildAdj(spec);

    // 每个事件一次 Dijkstra
    const dists = [];
    const prevs = [];
    for (const ev of events) {
      const r = dijkstra(rows * cols, adj, cellOf(ev));
      dists.push(r.dist);
      prevs.push(r.prev);
    }

    // 每事件到最近边界（距离相同取边界标识较小者）
    const evB = events.map((ev, i) => {
      let best = Infinity;
      let bid = -1;
      for (let b = 0; b < boundaries.length; b++) {
        const d = dists[i][cellOf(boundaries[b])];
        if (d < best) {
          best = d;
          bid = b;
        }
      }
      return { dist: best, bid: bid };
    });

    // 归约：事件节点 0..n-1，虚拟边界节点 n..2n-1
    const m = 2 * n;
    const edges = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = dists[i][cellOf(events[j])];
        if (d !== Infinity) edges.push([i, j, d]);
      }
    }
    for (let i = 0; i < n; i++) {
      if (evB[i].bid >= 0 && evB[i].dist !== Infinity) {
        edges.push([i, n + i, evB[i].dist]);
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        edges.push([n + i, n + j, 0]);
      }
    }

    const base = Matching.minWeightPerfectMatching(m, edges);
    if (!base) {
      return {
        ok: false,
        errors: [
          {
            code: 'unreachable',
            message: '存在无法配对且不可达任何边界的事件，无法构造完美匹配',
          },
        ],
      };
    }
    const C = base.cost;

    // 规范化：按事件录入顺序，逐个把描述子固定为可实现的最小值
    // 描述子序：边界(0) 优先于 配对(1)；配对时另一端事件标识升序
    //
    // 对事件 i 的一次求解即可完成其描述子最小化（精确整数扰动）：
    //   令 S = n+1，所有边权放大 S 倍；对 i 的关联边施加微扰——
    //   边界虚拟边 +0，到事件 j 的配对边 +(1+j)。
    //   任一完美匹配的微扰总和 < S，故最小化解必先保证原代价为 C，
    //   再在代价 C 的解中取 i 的描述子最小者。
    const fixed = new Map(); // i -> {type:'boundary'} | {type:'pair', with:j}
    function constrainedEdges() {
      const forced = new Map();
      for (const ent of fixed) {
        const i = ent[0], f = ent[1];
        forced.set(i, f.type === 'boundary' ? n + i : f.with);
      }
      return edges.filter((e) => {
        const a = e[0], b = e[1];
        if (a < n && forced.has(a) && b !== forced.get(a)) return false;
        if (b < n && forced.has(b) && a !== forced.get(b)) return false;
        return true;
      });
    }

    const S = n + 1;
    for (let i = 0; i < n; i++) {
      if (fixed.has(i)) continue;
      const perturbed = constrainedEdges().map((e) => {
        const a = e[0], b = e[1];
        let w = e[2] * S;
        if (a === i || b === i) {
          const other = a === i ? b : a;
          if (other !== n + i) w += 1 + other; // 配对边微扰；边界虚拟边 +0
        }
        return [a, b, w];
      });
      const res = Matching.minWeightPerfectMatching(m, perturbed);
      if (!res) throw new Error('internal: constrained matching infeasible');
      const pair = res.pairs.find((p) => p[0] === i || p[1] === i);
      const other = pair[0] === i ? pair[1] : pair[0];
      if (other === n + i) {
        fixed.set(i, { type: 'boundary' });
      } else {
        fixed.set(i, { type: 'pair', with: other });
        fixed.set(other, { type: 'pair', with: i });
      }
    }

    // 由规范描述子重建链
    function buildPath(i, targetCell) {
      const src = cellOf(events[i]);
      const prev = prevs[i];
      const ids = [];
      let cur = targetCell;
      let guard = 0;
      while (cur !== src && cur !== -1 && guard <= rows * cols + 1) {
        ids.push(cur);
        cur = prev[cur];
        guard++;
      }
      ids.push(src);
      ids.reverse();
      const path = ids.map((id) => [Math.floor(id / cols), id % cols]);
      const edgeCosts = [];
      for (let k = 0; k + 1 < path.length; k++) {
        edgeCosts.push(gridEdgeCost(spec, path[k], path[k + 1]));
      }
      return { path: path, edgeCosts: edgeCosts };
    }

    const chains = [];
    const assigned = new Array(n).fill(null);
    const seenEv = new Set();
    for (let i = 0; i < n; i++) {
      if (seenEv.has(i)) continue;
      const f = fixed.get(i);
      if (f.type === 'boundary') {
        seenEv.add(i);
        const bcell = boundaries[evB[i].bid];
        const bp = buildPath(i, cellOf(bcell));
        chains.push({
          id: chains.length,
          type: 'boundary',
          events: [i],
          boundary: evB[i].bid,
          endpoints: [
            { kind: 'event', index: i, cell: events[i] },
            { kind: 'boundary', index: evB[i].bid, cell: bcell },
          ],
          cost: evB[i].dist,
          path: bp.path,
          edgeCosts: bp.edgeCosts,
        });
        assigned[i] = { kind: 'boundary', chain: chains.length - 1 };
      } else {
        const j = f.with;
        seenEv.add(i);
        seenEv.add(j);
        const bp = buildPath(i, cellOf(events[j]));
        chains.push({
          id: chains.length,
          type: 'pair',
          events: [i, j],
          endpoints: [
            { kind: 'event', index: i, cell: events[i] },
            { kind: 'event', index: j, cell: events[j] },
          ],
          cost: dists[i][cellOf(events[j])],
          path: bp.path,
          edgeCosts: bp.edgeCosts,
        });
        assigned[i] = { kind: 'pair', chain: chains.length - 1 };
        assigned[j] = { kind: 'pair', chain: chains.length - 1 };
      }
    }
    const sumCost = chains.reduce((s, c) => s + c.cost, 0);
    if (sumCost !== C) {
      throw new Error('internal: chain cost sum ' + sumCost + ' != matching cost ' + C);
    }

    // 诊断信息（点选事件查看连接依据）
    let greedyBoundaryTotal = 0;
    let greedyPossible = true;
    for (let i = 0; i < n; i++) {
      if (evB[i].bid < 0 || evB[i].dist === Infinity) {
        greedyPossible = false;
        break;
      }
      greedyBoundaryTotal += evB[i].dist;
    }
    const diagnostics = {
      greedyBoundaryTotal: greedyPossible ? greedyBoundaryTotal : null,
      events: events.map((ev, i) => ({
        index: i,
        cell: ev,
        nearestBoundary:
          evB[i].bid >= 0 && evB[i].dist !== Infinity
            ? { boundary: evB[i].bid, cell: boundaries[evB[i].bid], dist: evB[i].dist }
            : null,
        toEvents: events.map((other, j) => (j === i ? null : dists[i][cellOf(other)])),
      })),
    };

    return {
      ok: true,
      totalCost: C,
      chains: chains,
      assignments: assigned,
      diagnostics: diagnostics,
      events: events,
      boundaries: boundaries,
    };
  }

  return {
    MIN_EVENTS: MIN_EVENTS,
    MAX_EVENTS: MAX_EVENTS,
    MAX_DIM: MAX_DIM,
    validate: validate,
    solve: solve,
    dijkstra: dijkstra,
    buildAdj: buildAdj,
  };
});
