/**
 * 矩形码格 SVG 渲染：
 * 格点、相邻边与代价、边界、检测事件（含录入序号）、求解链叠加；
 * 支持点选事件查看连接依据，及编辑模式下的边/边界/事件交互。
 */
import { state } from './state';
import { GridModel, edgeKey, rowOf, colOf } from '../solver/model';
import { Chain } from '../solver/solve';

const CELL = 64;
const PAD = 46;

const PAIR_COLOR = '#7ce0c4';
const BOUNDARY_COLOR = '#c792ea';
const SELECT_COLOR = '#5aa7ff';
const EVENT_COLOR = '#ffd166';
const EDGE_COLOR = '#5a6b86';
const MISSING_EDGE_COLOR = '#3a4660';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number | undefined> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) el.setAttribute(k, String(v));
  }
  return el;
}

export interface ViewOptions {
  showCosts: boolean;
  showIds: boolean;
}

export function renderGrid(container: HTMLElement, opts: ViewOptions): void {
  container.textContent = '';
  const m = state.model;
  const width = PAD * 2 + (m.cols - 1) * CELL;
  const height = PAD * 2 + (m.rows - 1) * CELL;
  const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}` });

  const xy = (v: number): [number, number] => [
    PAD + colOf(v, m) * CELL,
    PAD + rowOf(v, m) * CELL
  ];

  const boundarySet = new Set(m.boundaries);
  const eventIndex = new Map<number, number>();
  m.events.forEach((v, i) => eventIndex.set(v, i));

  // ---- 缺失相邻边：边编辑模式下显示虚线热区，点击补为代价 1 ----
  if (state.mode === 'edge') {
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        const v = r * m.cols + c;
        const candidates: number[] = [];
        if (c + 1 < m.cols) candidates.push(v + 1);
        if (r + 1 < m.rows) candidates.push(v + m.cols);
        for (const u of candidates) {
          if (m.edges[edgeKey(v, u)] !== undefined) continue;
          const [x1, y1] = xy(v);
          const [x2, y2] = xy(u);
          const line = svgEl('line', {
            x1, y1, x2, y2,
            stroke: MISSING_EDGE_COLOR,
            'stroke-width': 5,
            'stroke-dasharray': '3 7',
            'stroke-linecap': 'round',
            style: 'cursor:pointer'
          });
          line.addEventListener('click', () => {
            state.mutate((mm) => {
              mm.edges[edgeKey(v, u)] = 1;
            });
          });
          svg.appendChild(line);
        }
      }
    }
  }

  // ---- 边（含代价标签与点选热区）----
  for (const [key, cost] of Object.entries(m.edges)) {
    const [a, b] = key.split('|').map(Number);
    const [x1, y1] = xy(a);
    const [x2, y2] = xy(b);
    const selected =
      state.highlightedEdge !== null &&
      ((state.highlightedEdge[0] === a && state.highlightedEdge[1] === b) ||
        (state.highlightedEdge[0] === b && state.highlightedEdge[1] === a));
    svg.appendChild(
      svgEl('line', {
        x1, y1, x2, y2,
        stroke: selected ? SELECT_COLOR : EDGE_COLOR,
        'stroke-width': selected ? 4 : 2.5,
        'stroke-linecap': 'round'
      })
    );
    const hit = svgEl('line', { x1, y1, x2, y2, stroke: 'transparent', 'stroke-width': 16, style: 'cursor:pointer' });
    hit.addEventListener('click', () => state.locate(undefined, [a, b]));
    svg.appendChild(hit);

    if (opts.showCosts) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const tw = String(cost).length * 7.2 + 10;
      svg.appendChild(svgEl('rect', { x: mx - tw / 2, y: my - 9, width: tw, height: 16, rx: 4, fill: '#0b101d', stroke: '#2b3650', 'stroke-width': 1 }));
      const t = svgEl('text', { x: mx, y: my + 3.5, 'text-anchor': 'middle', 'font-size': 10, fill: '#9fb0cc' });
      t.textContent = String(cost);
      svg.appendChild(t);
    }
  }

  // ---- 链叠加：未选中先画，选中链置顶 ----
  const chains = state.result?.result?.chains ?? [];
  const drawChain = (ch: Chain, selected: boolean) => {
    const color = selected ? SELECT_COLOR : ch.kind === 'pair' ? PAIR_COLOR : BOUNDARY_COLOR;
    for (const e of ch.edges) {
      const [x1, y1] = xy(e.from);
      const [x2, y2] = xy(e.to);
      svg.appendChild(
        svgEl('line', {
          x1, y1, x2, y2,
          stroke: color,
          'stroke-width': selected ? 8 : 5,
          'stroke-linecap': 'round',
          opacity: selected ? 0.95 : 0.5,
          'stroke-dasharray': ch.kind === 'boundary' ? '7 4' : undefined
        })
      );
    }
    if (ch.kind === 'boundary' && ch.boundary !== null) {
      const [bx, by] = xy(ch.boundary);
      const prev = ch.vertices[ch.vertices.length - 2] ?? ch.boundary;
      const [px, py] = xy(prev);
      const ang = Math.atan2(by - py, bx - px);
      svg.appendChild(svgEl('polygon', { points: arrowPoints(bx, by, ang), fill: color, opacity: selected ? 0.95 : 0.7 }));
    }
  };
  for (const ch of chains) if (ch.id !== state.selectedChainId) drawChain(ch, false);
  const selectedChain = chains.find((c) => c.id === state.selectedChainId);
  if (selectedChain) drawChain(selectedChain, true);

  // ---- 格点 / 边界 / 事件 ----
  for (let v = 0; v < m.rows * m.cols; v++) {
    const [x, y] = xy(v);
    const isBoundary = boundarySet.has(v);
    const isHL = state.highlightedVertex === v;
    const evIdx = eventIndex.get(v);

    if (isBoundary) {
      svg.appendChild(
        svgEl('rect', {
          x: x - 15, y: y - 15, width: 30, height: 30, rx: 7,
          fill: '#2a1e3a',
          stroke: isHL ? SELECT_COLOR : BOUNDARY_COLOR,
          'stroke-width': isHL ? 2.5 : 1.5
        })
      );
    }

    if (evIdx === undefined) {
      svg.appendChild(svgEl('circle', { cx: x, cy: y, r: isHL ? 7 : 5, fill: isHL ? SELECT_COLOR : '#8fa0bd' }));
      if (opts.showIds) {
        const t = svgEl('text', { x, y: y - 13, 'text-anchor': 'middle', 'font-size': 9, fill: '#5c6b88' });
        t.textContent = String(v);
        svg.appendChild(t);
      }
    } else {
      const involved = chainOfEvent(evIdx)?.id === state.selectedChainId;
      const ring = involved || state.selectedEvent === evIdx;
      svg.appendChild(
        svgEl('circle', {
          cx: x, cy: y, r: 13,
          fill: EVENT_COLOR,
          stroke: ring ? SELECT_COLOR : '#8a6d1f',
          'stroke-width': ring ? 3 : 1.5
        })
      );
      const t = svgEl('text', { x, y: y + 4, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: '#1a1408', style: 'pointer-events:none' });
      t.textContent = String(evIdx + 1);
      svg.appendChild(t);
    }

    // 统一交互热区（编辑模式与点选事件）
    const hit = svgEl('circle', { cx: x, cy: y, r: 17, fill: 'transparent', style: 'cursor:pointer' });
    hit.addEventListener('click', () => onVertexClick(v));
    svg.appendChild(hit);
  }

  container.appendChild(svg);
}

function arrowPoints(tipX: number, tipY: number, ang: number): string {
  const size = 9;
  const baseX = tipX - Math.cos(ang) * 12;
  const baseY = tipY - Math.sin(ang) * 12;
  const p1 = `${baseX + Math.cos(ang + Math.PI / 2) * size},${baseY + Math.sin(ang + Math.PI / 2) * size}`;
  const p2 = `${baseX - Math.cos(ang + Math.PI / 2) * size},${baseY - Math.sin(ang + Math.PI / 2) * size}`;
  return `${tipX},${tipY} ${p1} ${p2}`;
}

export function chainOfEvent(evIdx: number): Chain | undefined {
  return state.result?.result?.chains.find((c) => c.eventA === evIdx || c.eventB === evIdx);
}

function onVertexClick(vertex: number): void {
  const evIdx = state.model.events.indexOf(vertex);
  if (state.mode === 'event-remove') {
    if (evIdx !== -1) {
      state.mutate((mm: GridModel) => {
        mm.events = mm.events.filter((v) => v !== vertex);
      });
    }
    return;
  }
  if (state.mode === 'boundary') {
    state.mutate((mm: GridModel) => {
      if (mm.boundaries.includes(vertex)) mm.boundaries = mm.boundaries.filter((v) => v !== vertex);
      else mm.boundaries = [...mm.boundaries, vertex];
    });
    return;
  }
  if (state.mode === 'event-add') {
    if (evIdx === -1) {
      state.mutate((mm: GridModel) => {
        if (mm.events.length < 48) mm.events = [...mm.events, vertex];
      });
    }
    return;
  }
  // select 模式：点选事件查看连接依据
  if (evIdx !== -1) {
    const ch = chainOfEvent(evIdx);
    state.selectChain(ch ? ch.id : null, evIdx);
    state.locate(vertex);
  } else {
    state.locate(vertex);
  }
}
