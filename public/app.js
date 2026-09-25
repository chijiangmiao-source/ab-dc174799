/*
 * 前端主逻辑：网格编辑、Worker 求解调度、结果绘制与连接依据查看。
 *
 * 防陈旧结果约定：
 *   - 每次编辑使 editSeq 自增；发起求解时记录 sentEditSeq 与 runId。
 *   - Worker 返回时若 runId 不是当前运行，或 editSeq 已变（求解期间改动过网格），
 *     则丢弃该结果——旧结果不得覆盖新草稿或新结果。
 *   - 取消按钮直接终止 Worker 并使 runId 失效。
 */
'use strict';

(function () {
  const CELL = 38;

  const state = {
    spec: null,          // {rows, cols, hCosts, vCosts, boundaries, events}
    mode: 'event',
    result: null,        // 当前展示的求解结果
    resultStale: false,
    solving: false,
    runId: 0,
    sentEditSeq: -1,
    editSeq: 0,
    worker: null,
    selectedEvent: null, // 查看依据的事件下标
    selectedEdge: null,  // [[r,c],[r,c]]
    selectedChain: null,
    highlight: null,     // 校验错误定位高亮 {cell|edge|cells}
    errors: [],
  };

  /* ---------------- 规格操作 ---------------- */

  function emptySpec(rows, cols) {
    const hCosts = [];
    for (let r = 0; r < rows; r++) hCosts.push(new Array(Math.max(0, cols - 1)).fill(1));
    const vCosts = [];
    for (let r = 0; r < rows - 1; r++) vCosts.push(new Array(cols).fill(1));
    return { rows, cols, hCosts, vCosts, boundaries: [], events: [] };
  }

  function normalizeSpec(raw) {
    // 宽容地把外部 JSON 规整为完整规格；不合法值留给 Solver.validate 定位
    const rows = Number.isInteger(raw && raw.rows) ? raw.rows : 6;
    const cols = Number.isInteger(raw && raw.cols) ? raw.cols : 8;
    const spec = emptySpec(rows, cols);
    if (raw && Array.isArray(raw.hCosts)) {
      for (let r = 0; r < rows; r++) {
        if (!Array.isArray(raw.hCosts[r])) continue;
        for (let c = 0; c < cols - 1; c++) {
          if (raw.hCosts[r][c] !== undefined) spec.hCosts[r][c] = raw.hCosts[r][c];
        }
      }
    }
    if (raw && Array.isArray(raw.vCosts)) {
      for (let r = 0; r < rows - 1; r++) {
        if (!Array.isArray(raw.vCosts[r])) continue;
        for (let c = 0; c < cols; c++) {
          if (raw.vCosts[r][c] !== undefined) spec.vCosts[r][c] = raw.vCosts[r][c];
        }
      }
    }
    spec.boundaries = raw && Array.isArray(raw.boundaries) ? raw.boundaries.map((b) => (Array.isArray(b) ? [b[0], b[1]] : b)) : [];
    spec.events = raw && Array.isArray(raw.events) ? raw.events.map((e) => (Array.isArray(e) ? [e[0], e[1]] : e)) : [];
    return spec;
  }

  function markEdit() {
    state.editSeq++;
    if (state.result) state.resultStale = true;
    state.selectedEvent = null;
    state.selectedChain = null;
    validateNow();
    render();
  }

  function validateNow() {
    state.errors = Solver.validate(state.spec);
  }

  /* ---------------- Worker 调度 ---------------- */

  function ensureWorker() {
    if (state.worker) return;
    state.worker = new Worker('/src/worker.js');
    state.worker.onmessage = (e) => {
      const data = e.data || {};
      // 陈旧运行：已有更新的求解请求
      if (data.runId !== state.runId) {
        window.__dbg.discarded++;
        return;
      }
      // 求解期间网格被改动：旧结果不得覆盖新草稿
      if (state.editSeq !== state.sentEditSeq) {
        window.__dbg.discarded++;
        state.solving = false; // 本次运行的结果已作废，不再等待
        render();
        return;
      }
      window.__dbg.results++;
      state.solving = false;
      if (data.ok) {
        state.result = data;
        state.resultStale = false;
        state.errors = [];
      } else if (data.errors) {
        state.result = null;
        state.errors = data.errors;
      } else {
        state.result = null;
        state.errors = [{ code: 'fatal', message: '求解内部错误：' + (data.fatal || '未知') }];
      }
      render();
    };
    state.worker.onerror = (err) => {
      state.solving = false;
      state.errors = [{ code: 'fatal', message: 'Worker 异常：' + (err.message || err) }];
      render();
    };
  }

  function solve() {
    validateNow();
    if (state.errors.length) {
      render();
      return;
    }
    ensureWorker();
    state.runId++;
    state.sentEditSeq = state.editSeq;
    state.solving = true;
    state.result = null;
    const spec = JSON.parse(JSON.stringify(state.spec));
    state.worker.postMessage({ type: 'solve', runId: state.runId, spec });
    render();
  }

  function cancelSolve() {
    if (state.worker) {
      state.worker.terminate();
      state.worker = null;
    }
    state.runId++; // 使任何迟到的消息失效
    state.solving = false;
    render();
  }

  /* ---------------- 渲染 ---------------- */

  const canvas = document.getElementById('grid');
  const ctx = canvas.getContext('2d');

  const CHAIN_COLORS = [
    '#e8a13d', '#8e6fd8', '#3fb27f', '#d85f8a', '#4d9de0', '#c2c24a',
    '#d97b4f', '#5fc4c9', '#b06fd8', '#7fb069', '#e06c60', '#61afef',
  ];

  function edgeKey(a, b) {
    return a[0] + ',' + a[1] + '|' + b[0] + ',' + b[1];
  }

  function render() {
    renderStatus();
    renderErrors();
    renderEdgePanel();
    renderResult();
    renderInspect();
    draw();
  }

  function renderStatus() {
    const el = document.getElementById('status');
    const n = state.spec.events.length;
    let text = '事件 ' + n + ' / ' + Solver.MAX_EVENTS + ' · 边界 ' + state.spec.boundaries.length + ' 格';
    if (state.solving) text += ' · 求解中…';
    el.textContent = text;
    document.getElementById('solve').disabled = state.solving;
    document.getElementById('cancel').disabled = !state.solving;
  }

  function renderErrors() {
    const ul = document.getElementById('errors');
    ul.innerHTML = '';
    for (const err of state.errors) {
      const li = document.createElement('li');
      li.textContent = err.message;
      if (err.at) {
        const btn = document.createElement('button');
        btn.textContent = '定位';
        btn.className = 'locate';
        btn.onclick = () => {
          state.highlight = atToHighlight(err.at);
          draw();
        };
        li.appendChild(btn);
      }
      ul.appendChild(li);
    }
  }

  function atToHighlight(at) {
    if (at.cell) return { cell: at.cell };
    if (at.edge) return { edge: at.edge };
    if (at.events) return { cells: at.events.map((i) => state.spec.events[i]).filter(Boolean) };
    if (at.event !== undefined) return { cell: state.spec.events[at.event] };
    if (at.boundary !== undefined) return { cell: state.spec.boundaries[at.boundary] };
    return null;
  }

  function renderEdgePanel() {
    const panel = document.getElementById('edgePanel');
    if (!state.selectedEdge) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const [a, b] = state.selectedEdge;
    const cur = getEdgeCost(a, b);
    document.getElementById('edgeInfo').textContent =
      '边 (' + a[0] + ',' + a[1] + ') — (' + b[0] + ',' + b[1] + ') 当前代价 ' + cur;
    document.getElementById('edgeCost').value = cur;
  }

  function endpointName(ep) {
    if (ep.kind === 'event') return 'E' + (ep.index + 1) + ' (' + ep.cell[0] + ',' + ep.cell[1] + ')';
    return '边界 B' + (ep.index + 1) + ' (' + ep.cell[0] + ',' + ep.cell[1] + ')';
  }

  function renderResult() {
    const panel = document.getElementById('resultPanel');
    if (!state.result) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    document.getElementById('staleBadge').hidden = !state.resultStale;
    const res = state.result;
    const greedy = res.diagnostics.greedyBoundaryTotal;
    let html = '<b>总代价 ' + res.totalCost + '</b>（精确整数最小权匹配）';
    if (greedy !== null) {
      html += '<br>若每个事件机械连向最近边界：总代价 ' + greedy;
      if (greedy > res.totalCost) {
        html += '，<b>配对解释节省 ' + (greedy - res.totalCost) + '</b>';
      } else if (greedy === res.totalCost) {
        html += '（与最优相同）';
      }
    } else {
      html += '<br>（无可用边界，全部事件两两配对）';
    }
    document.getElementById('summary').innerHTML = html;

    const ol = document.getElementById('chains');
    ol.innerHTML = '';
    res.chains.forEach((ch) => {
      const li = document.createElement('li');
      li.style.borderLeftColor = CHAIN_COLORS[ch.id % CHAIN_COLORS.length];
      const eps = ch.endpoints.map(endpointName).join('  ↔  ');
      const perEdge = ch.edgeCosts.length ? ch.edgeCosts.join(' + ') : '（零距离）';
      li.innerHTML =
        '<div class="chainHead">链 ' + (ch.id + 1) +
        (ch.type === 'pair' ? ' · 事件配对' : ' · 边界链') + ' · 代价 ' + ch.cost + '</div>' +
        '<div class="chainEps">' + eps + '</div>' +
        '<div class="chainEdges">逐边代价：' + perEdge + '</div>';
      li.onclick = () => {
        state.selectedChain = state.selectedChain === ch.id ? null : ch.id;
        state.selectedEvent = null;
        draw();
        renderInspect();
      };
      if (state.selectedChain === ch.id) li.classList.add('selected');
      ol.appendChild(li);
    });
  }

  function renderInspect() {
    const panel = document.getElementById('inspectPanel');
    if (state.selectedEvent === null || !state.result) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const i = state.selectedEvent;
    const res = state.result;
    const diag = res.diagnostics.events[i];
    const asg = res.assignments[i];
    const ch = res.chains[asg.chain];
    const body = document.getElementById('inspectBody');
    let html = '<h3>事件 E' + (i + 1) + ' (' + diag.cell[0] + ',' + diag.cell[1] + ')</h3>';
    html += '<p>由链 ' + (ch.id + 1) + ' 消去：' + ch.endpoints.map(endpointName).join(' ↔ ') +
      '，链代价 <b>' + ch.cost + '</b>' +
      (ch.edgeCosts.length ? '（' + ch.edgeCosts.join(' + ') + '）' : '') + '。</p>';
    html += '<p>候选连接（最短链距离）：</p><ul>';
    if (diag.nearestBoundary) {
      html += '<li>到最近边界 B' + (diag.nearestBoundary.boundary + 1) +
        ' (' + diag.nearestBoundary.cell[0] + ',' + diag.nearestBoundary.cell[1] + ')：' +
        diag.nearestBoundary.dist + '</li>';
    } else {
      html += '<li>无可用边界终点</li>';
    }
    diag.toEvents.forEach((d, j) => {
      if (d === null) return;
      html += '<li>到 E' + (j + 1) + '：' + (d === Infinity ? '不可达' : d) + '</li>';
    });
    html += '</ul>';
    html += '<p class="note">全局总代价 ' + res.totalCost +
      ' 为精确整数最小权完美匹配最优值；同成本时按事件录入顺序逐项比较' +
      '“边界优先、随后另一端标识升序”的链向量得出规范结论。</p>';
    body.innerHTML = html;
  }

  /* ---------------- 画布 ---------------- */

  function draw() {
    const spec = state.spec;
    const w = spec.cols * CELL + 1;
    const h = spec.rows * CELL + 1;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 网格线
    ctx.strokeStyle = '#3a4150';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let r = 0; r <= spec.rows; r++) {
      ctx.moveTo(0.5, r * CELL + 0.5);
      ctx.lineTo(spec.cols * CELL + 0.5, r * CELL + 0.5);
    }
    for (let c = 0; c <= spec.cols; c++) {
      ctx.moveTo(c * CELL + 0.5, 0.5);
      ctx.lineTo(c * CELL + 0.5, spec.rows * CELL + 0.5);
    }
    ctx.stroke();

    // 非 1 边代价标注
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let r = 0; r < spec.rows; r++) {
      for (let c = 0; c < spec.cols - 1; c++) {
        const cost = spec.hCosts[r][c];
        if (cost !== 1) drawEdgeLabel(r * CELL + CELL / 2, c * CELL + CELL, cost);
      }
    }
    for (let r = 0; r < spec.rows - 1; r++) {
      for (let c = 0; c < spec.cols; c++) {
        const cost = spec.vCosts[r][c];
        if (cost !== 1) drawEdgeLabel(r * CELL + CELL, c * CELL + CELL / 2, cost);
      }
    }

    // 边界格
    for (const b of spec.boundaries) {
      if (!inGrid(b)) continue;
      ctx.fillStyle = 'rgba(77,157,224,0.28)';
      ctx.fillRect(b[1] * CELL + 1, b[0] * CELL + 1, CELL - 1, CELL - 1);
      ctx.strokeStyle = '#4d9de0';
      ctx.lineWidth = 2;
      ctx.strokeRect(b[1] * CELL + 2, b[0] * CELL + 2, CELL - 3, CELL - 3);
    }

    // 求解链
    if (state.result) {
      state.result.chains.forEach((ch) => {
        const dim =
          (state.selectedChain !== null && state.selectedChain !== ch.id) ||
          (state.selectedEvent !== null &&
            !ch.events.includes(state.selectedEvent));
        drawChain(ch, dim);
      });
    }

    // 事件
    state.spec.events.forEach((ev, i) => {
      if (!inGrid(ev)) return;
      const x = ev[1] * CELL + CELL / 2;
      const y = ev[0] * CELL + CELL / 2;
      ctx.beginPath();
      ctx.arc(x, y, CELL * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = state.selectedEvent === i ? '#ff7b72' : '#e5484d';
      ctx.fill();
      if (state.selectedEvent === i) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffd33d';
        ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(String(i + 1), x, y);
    });

    // 选中边
    if (state.selectedEdge) {
      const [a, b] = state.selectedEdge;
      ctx.strokeStyle = '#ffd33d';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(a[1] * CELL + CELL / 2, a[0] * CELL + CELL / 2);
      ctx.lineTo(b[1] * CELL + CELL / 2, b[0] * CELL + CELL / 2);
      ctx.stroke();
    }

    // 校验错误定位高亮
    if (state.highlight) {
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 3]);
      const cells = [];
      if (state.highlight.cell) cells.push(state.highlight.cell);
      if (state.highlight.cells) cells.push(...state.highlight.cells);
      if (state.highlight.edge) cells.push(...state.highlight.edge);
      for (const cell of cells) {
        if (!cell || !inGrid(cell)) continue;
        ctx.strokeRect(cell[1] * CELL + 2, cell[0] * CELL + 2, CELL - 3, CELL - 3);
      }
      ctx.setLineDash([]);
    }
  }

  function drawEdgeLabel(y, x, cost) {
    ctx.fillStyle = '#20242c';
    ctx.fillRect(x - 8, y - 7, 16, 14);
    ctx.fillStyle = '#e8a13d';
    ctx.fillText(String(cost), x, y);
  }

  function drawChain(ch, dim) {
    const color = CHAIN_COLORS[ch.id % CHAIN_COLORS.length];
    ctx.save();
    ctx.globalAlpha = dim ? 0.15 : 0.9;
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (ch.type === 'boundary') ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ch.path.forEach((cell, k) => {
      const x = cell[1] * CELL + CELL / 2;
      const y = cell[0] * CELL + CELL / 2;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function inGrid(cell) {
    return (
      Array.isArray(cell) &&
      cell[0] >= 0 &&
      cell[1] >= 0 &&
      cell[0] < state.spec.rows &&
      cell[1] < state.spec.cols
    );
  }

  /* ---------------- 交互 ---------------- */

  function canvasCell(evt) {
    const rect = canvas.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    return { c: Math.floor(x / CELL), r: Math.floor(y / CELL), fx: (x % CELL) / CELL, fy: (y % CELL) / CELL };
  }

  canvas.addEventListener('click', (evt) => {
    const { r, c, fx, fy } = canvasCell(evt);
    if (r < 0 || c < 0 || r >= state.spec.rows || c >= state.spec.cols) return;
    state.highlight = null;
    if (state.mode === 'event') {
      const idx = state.spec.events.findIndex((e) => e[0] === r && e[1] === c);
      if (idx >= 0) {
        state.spec.events.splice(idx, 1);
      } else {
        if (state.spec.events.length >= Solver.MAX_EVENTS) {
          state.errors = [{ code: 'event-count', message: '事件数量已达上限 ' + Solver.MAX_EVENTS }];
          render();
          return;
        }
        state.spec.events.push([r, c]);
      }
      markEdit();
    } else if (state.mode === 'boundary') {
      const idx = state.spec.boundaries.findIndex((b) => b[0] === r && b[1] === c);
      if (idx >= 0) state.spec.boundaries.splice(idx, 1);
      else state.spec.boundaries.push([r, c]);
      markEdit();
    } else if (state.mode === 'edge') {
      state.selectedEdge = pickEdge(r, c, fx, fy);
      render();
    } else if (state.mode === 'inspect') {
      const idx = state.spec.events.findIndex((e) => e[0] === r && e[1] === c);
      if (idx >= 0 && state.result && state.result.assignments[idx]) {
        state.selectedEvent = idx;
        state.selectedChain = null;
        render();
      }
    }
  });

  function pickEdge(r, c, fx, fy) {
    // 依据点击位置在单元格内的偏移，选最近的一条边
    const candidates = [];
    if (c + 1 < state.spec.cols) candidates.push({ e: [[r, c], [r, c + 1]], d: 1 - fx });
    if (c > 0) candidates.push({ e: [[r, c - 1], [r, c]], d: fx });
    if (r + 1 < state.spec.rows) candidates.push({ e: [[r, c], [r + 1, c]], d: 1 - fy });
    if (r > 0) candidates.push({ e: [[r - 1, c], [r, c]], d: fy });
    candidates.sort((a, b) => a.d - b.d);
    return candidates.length ? candidates[0].e : null;
  }

  function getEdgeCost(a, b) {
    return Solver && state.spec ? gridCost(a, b) : 1;
  }

  function gridCost(a, b) {
    if (a[0] === b[0]) {
      const cc = Math.min(a[1], b[1]);
      return state.spec.hCosts[a[0]][cc];
    }
    const rr = Math.min(a[0], b[0]);
    return state.spec.vCosts[rr][a[1]];
  }

  function setEdgeCost(a, b, val) {
    if (a[0] === b[0]) {
      const cc = Math.min(a[1], b[1]);
      state.spec.hCosts[a[0]][cc] = val;
    } else {
      const rr = Math.min(a[0], b[0]);
      state.spec.vCosts[rr][a[1]] = val;
    }
  }

  document.getElementById('edgeApply').addEventListener('click', () => {
    const errEl = document.getElementById('edgeError');
    errEl.textContent = '';
    if (!state.selectedEdge) return;
    const raw = document.getElementById('edgeCost').value;
    const val = Number(raw);
    if (!Number.isInteger(val) || val <= 0) {
      const [a, b] = state.selectedEdge;
      errEl.textContent =
        '边 (' + a[0] + ',' + a[1] + ')—(' + b[0] + ',' + b[1] + ') 的代价须为正整数，收到 ' + raw;
      return;
    }
    setEdgeCost(state.selectedEdge[0], state.selectedEdge[1], val);
    markEdit();
  });

  document.querySelectorAll('#modes .mode').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#modes .mode').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;
      if (state.mode !== 'edge') state.selectedEdge = null;
      render();
    });
  });

  document.getElementById('applySize').addEventListener('click', () => {
    const rows = Math.max(1, Math.min(60, Number(document.getElementById('rows').value) || 1));
    const cols = Math.max(1, Math.min(60, Number(document.getElementById('cols').value) || 1));
    const old = state.spec;
    const next = emptySpec(rows, cols);
    for (let r = 0; r < Math.min(rows, old.rows); r++) {
      for (let c = 0; c < Math.min(cols - 1, old.cols - 1); c++) {
        if (c >= 0) next.hCosts[r][c] = old.hCosts[r][c];
      }
    }
    for (let r = 0; r < Math.min(rows - 1, old.rows - 1); r++) {
      for (let c = 0; c < Math.min(cols, old.cols); c++) {
        next.vCosts[r][c] = old.vCosts[r][c];
      }
    }
    // 越界的事件与边界保留，由校验在求解时定位提示
    next.events = old.events.slice();
    next.boundaries = old.boundaries.slice();
    state.spec = next;
    markEdit();
  });

  document.getElementById('solve').addEventListener('click', solve);
  document.getElementById('cancel').addEventListener('click', cancelSolve);

  document.getElementById('clearAll').addEventListener('click', () => {
    state.spec = emptySpec(state.spec.rows, state.spec.cols);
    state.result = null;
    state.highlight = null;
    state.selectedEdge = null;
    markEdit();
  });

  document.getElementById('example').addEventListener('click', () => {
    // 示例：局部最近边界并非全局最优——中间两事件配对远优于各自连边界
    const spec = emptySpec(4, 7);
    spec.hCosts[1][2] = 3;
    spec.hCosts[2][2] = 3;
    spec.vCosts[0][3] = 2;
    spec.vCosts[1][3] = 2;
    spec.vCosts[2][3] = 2;
    spec.boundaries = [
      [0, 0],
      [3, 6],
    ];
    spec.events = [
      [1, 3],
      [2, 3],
      [0, 5],
      [3, 1],
    ];
    state.spec = spec;
    state.result = null;
    state.highlight = null;
    markEdit();
    solve();
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    document.getElementById('jsonBox').value = JSON.stringify(state.spec, null, 2);
  });

  document.getElementById('importBtn').addEventListener('click', () => {
    const box = document.getElementById('jsonBox');
    try {
      const raw = JSON.parse(box.value);
      state.spec = normalizeSpec(raw);
      state.result = null;
      state.highlight = null;
      markEdit();
    } catch (err) {
      state.errors = [{ code: 'spec', message: 'JSON 解析失败：' + err.message }];
      render();
    }
  });

  /* ---------------- 启动 ---------------- */

  // 诊断计数（验收与调试用）：被丢弃的陈旧结果数 / 已展示的结果数
  window.__dbg = { discarded: 0, results: 0 };

  state.spec = emptySpec(6, 8);
  validateNow();
  render();
})();
