/**
 * 应用入口：工具栏、画布、侧栏检视面板的装配与重绘调度。
 * 所有状态变更经 AppState（含 Worker 版本防护），本文件只负责 DOM。
 */
import './ui/styles.css';
import { state } from './ui/state';
import { renderGrid } from './ui/renderer';
import { renderInspector } from './ui/inspector';
import { defaultGrid, edgeKey, areAdjacent, parseEdgeKey, GridModel } from './solver/model';

const canvasWrap = document.getElementById('canvas-wrap')!;
const inspector = document.getElementById('inspector')!;
const toolbar = document.getElementById('toolbar')!;
const statusbar = document.getElementById('statusbar')!;
const topActions = document.getElementById('top-actions')!;

const view = { showCosts: true, showIds: false };

type Mode = typeof state.mode;
const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: 'select', label: '浏览/点选', hint: '点事件查看连接依据' },
  { key: 'edge', label: '编辑边', hint: '点虚线补边，右侧改代价' },
  { key: 'boundary', label: '编辑边界', hint: '点格点切换边界终点' },
  { key: 'event-add', label: '添加事件', hint: '点格点按顺序录入事件' },
  { key: 'event-remove', label: '删除事件', hint: '点事件删除' }
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderToolbar(): void {
  toolbar.textContent = '';

  // 模式按钮
  const g1 = el('div', { class: 'group' });
  for (const mo of MODES) {
    const b = el('button', { class: state.mode === mo.key ? 'active' : '', title: mo.hint }, mo.label);
    b.addEventListener('click', () => {
      state.mode = mo.key;
      state.locate(undefined, undefined);
      renderAll();
    });
    g1.appendChild(b);
  }
  toolbar.appendChild(g1);
  toolbar.appendChild(el('div', { class: 'sep' }));

  // 网格尺寸
  const g2 = el('div', { class: 'group' });
  g2.appendChild(el('label', { class: 'field' }, '行'));
  const rowsIn = el('input', { type: 'number', min: '1', max: '20', value: String(state.model.rows) }) as HTMLInputElement;
  const colsIn = el('input', { type: 'number', min: '1', max: '20', value: String(state.model.cols) }) as HTMLInputElement;
  g2.appendChild(rowsIn);
  g2.appendChild(el('label', { class: 'field' }, '列'));
  g2.appendChild(colsIn);
  const applySize = el('button', {}, '应用尺寸');
  applySize.addEventListener('click', () => {
    const r = Math.max(1, Math.min(20, Number(rowsIn.value) || state.model.rows));
    const c = Math.max(1, Math.min(20, Number(colsIn.value) || state.model.cols));
    resizeGrid(r, c);
  });
  g2.appendChild(applySize);
  toolbar.appendChild(g2);
  toolbar.appendChild(el('div', { class: 'sep' }));

  // 显示开关
  const g3 = el('div', { class: 'group' });
  const costBtn = el('button', { class: view.showCosts ? 'active' : '' }, '边代价');
  costBtn.addEventListener('click', () => {
    view.showCosts = !view.showCosts;
    renderAll();
  });
  const idBtn = el('button', { class: view.showIds ? 'active' : '' }, '格点号');
  idBtn.addEventListener('click', () => {
    view.showIds = !view.showIds;
    renderAll();
  });
  g3.appendChild(costBtn);
  g3.appendChild(idBtn);
  toolbar.appendChild(g3);

  // 边代价编辑（编辑边模式且选中一条边）
  if (state.mode === 'edge' && state.highlightedEdge) {
    toolbar.appendChild(el('div', { class: 'sep' }));
    const g4 = el('div', { class: 'group' });
    const [a, b] = state.highlightedEdge;
    const cur = state.model.edges[edgeKey(a, b)];
    g4.appendChild(el('label', { class: 'field' }, `边 ${a}–${b} 代价`));
    const costIn = el('input', { type: 'number', min: '1', step: '1', value: cur !== undefined ? String(cur) : '1' }) as HTMLInputElement;
    costIn.classList.add('wide');
    const save = el('button', { class: 'primary' }, '保存');
    const apply = () => {
      const w = Math.trunc(Number(costIn.value));
      if (!Number.isFinite(w) || w <= 0) {
        costIn.style.borderColor = 'var(--error)';
        return;
      }
      state.mutate((mm: GridModel) => {
        mm.edges[edgeKey(a, b)] = w;
      });
    };
    save.addEventListener('click', apply);
    costIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') apply();
    });
    const del = el('button', { class: 'danger' }, '删除边');
    del.addEventListener('click', () => {
      state.mutate((mm: GridModel) => {
        delete mm.edges[edgeKey(a, b)];
        state.locate(undefined, undefined);
      });
    });
    g4.appendChild(costIn);
    g4.appendChild(save);
    g4.appendChild(del);
    toolbar.appendChild(g4);
  }
}

function resizeGrid(rows: number, cols: number): void {
  state.mutate((m: GridModel) => {
    const next = defaultGrid(rows, cols);
    // 保留与新网格相容的既有边与正整数代价
    const edges: Record<string, number> = {};
    for (const [k, w] of Object.entries(m.edges)) {
      const [a, b] = parseEdgeKey(k);
      if (areAdjacent(a, b, cols, rows) && w > 0) edges[k] = w;
    }
    m.rows = rows;
    m.cols = cols;
    m.edges = Object.keys(edges).length ? edges : next.edges;
    m.boundaries = m.boundaries.filter((v) => v >= 0 && v < rows * cols);
    if (m.boundaries.length === 0) m.boundaries = next.boundaries;
    m.events = m.events.filter((v) => v >= 0 && v < rows * cols);
  });
}

function renderTopActions(): void {
  topActions.textContent = '';
  const solveBtn = el('button', { class: 'primary' }, '重新求解');
  solveBtn.addEventListener('click', () => state.solve());
  topActions.appendChild(solveBtn);
  const cancelBtn = el('button', { class: 'danger' }, '取消任务');
  cancelBtn.disabled = !state.running;
  cancelBtn.addEventListener('click', () => state.cancel());
  topActions.appendChild(cancelBtn);
  const resetBtn = el('button', {}, '重置示例');
  resetBtn.addEventListener('click', () => {
    state.mode = 'select';
    state.replaceModel(defaultGrid());
  });
  topActions.appendChild(resetBtn);
}

function renderStatus(): void {
  statusbar.textContent = '';
  const m = state.model;
  const left = el('div', {}, `网格 ${m.rows}×${m.cols}　边 ${Object.keys(m.edges).length} 条　边界 ${m.boundaries.length} 个　事件 ${m.events.length}/48 个`);
  statusbar.appendChild(left);
  const legend = el('div', { class: 'legend' });
  legend.innerHTML = `<span><i style="background:#ffd166"></i>检测事件（数字=录入顺序）</span>
    <span><i style="background:#c792ea"></i>边界终点</span>
    <span><i style="background:#7ce0c4"></i>事件对链</span>
    <span><i style="background:#c792ea"></i>边界链</span>`;
  statusbar.appendChild(legend);
  if (state.running) {
    const s = el('div', { style: 'margin-left:auto;display:flex;align-items:center;gap:6px' });
    s.innerHTML = `<span class="spinner"></span>`;
    s.append('求解中…（改动网格将自动取消并以草稿为准）');
    statusbar.appendChild(s);
  } else if (state.stale) {
    const s = el('div', { style: 'margin-left:auto' });
    s.innerHTML = `<span class="badge stale">旧结果</span>`;
    s.append(' 不代表当前草稿，新求解完成前保留仅作参照');
    statusbar.appendChild(s);
  }
}

function renderAll(): void {
  renderToolbar();
  renderTopActions();
  renderGrid(canvasWrap, view);
  renderInspector(inspector);
  renderStatus();
}

state.subscribe(renderAll);

// 首次载入：放入一个能直观演示“局部最近边界并非全局最优”的示例
function seedDemo(): void {
  const m = defaultGrid(3, 5);
  m.boundaries = [];
  for (let c = 0; c < 5; c++) {
    m.boundaries.push(c); // 上行
    m.boundaries.push(2 * 5 + c); // 下行
  }
  // 两事件位于中行相邻格：各自到最近边界 1，成对链 1 → 成对更优（2 vs 1）
  m.events = [1 * 5 + 1, 1 * 5 + 2];
  state.replaceModel(m, { autosolve: false });
  state.solve();
}

// 尽早替换默认模型再首次渲染
state.replaceModel(defaultGrid(), { autosolve: false });
seedDemo();
renderAll();
