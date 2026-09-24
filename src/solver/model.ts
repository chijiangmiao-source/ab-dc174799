/**
 * 问题数据模型：可编辑矩形码格。
 *
 * - rows×cols 个格点（顶点），行列均从 0 开始编号；顶点 id = r*cols + c。
 * - 边只允许在正交相邻格点之间（水平/垂直），代价为正整数。
 * - 边界是可作链终点的格点集合。
 * - 检测事件 2..48 个，按录入顺序（0 起）保存；同一格点不允许重复事件。
 */

export interface GridModel {
  rows: number;
  cols: number;
  /** 边键 `${a}|${b}`（a<b）=> 正整数代价 */
  edges: Record<string, number>;
  /** 可作终点的边界格点 id 集合 */
  boundaries: number[];
  /** 检测事件，按录入顺序 */
  events: number[];
}

export const MAX_EVENTS = 48;
export const MIN_EVENTS = 2;

export const vid = (r: number, c: number, cols: number): number => r * cols + c;
export const rowOf = (v: number, m: Pick<GridModel, 'cols'>): number => Math.floor(v / m.cols);
export const colOf = (v: number, m: Pick<GridModel, 'cols'>): number => v % m.cols;

export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function parseEdgeKey(key: string): [number, number] {
  const [a, b] = key.split('|').map(Number);
  return [a, b];
}

/** 两格点是否正交相邻（边只允许在相邻格间） */
export function areAdjacent(a: number, b: number, cols: number, rows: number): boolean {
  if (a === b || a < 0 || b < 0) return false;
  const ra = Math.floor(a / cols);
  const ca = a % cols;
  const rb = Math.floor(b / cols);
  const cb = b % cols;
  if (ra >= rows || rb >= rows || ca >= cols || cb >= cols) return false;
  return (ra === rb && Math.abs(ca - cb) === 1) || (ca === cb && Math.abs(ra - rb) === 1);
}

export function defaultGrid(rows = 4, cols = 6): GridModel {
  const edges: Record<string, number> = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = vid(r, c, cols);
      if (c + 1 < cols) edges[edgeKey(v, vid(r, c + 1, cols))] = 1;
      if (r + 1 < rows) edges[edgeKey(v, vid(r + 1, c, cols))] = 1;
    }
  }
  const boundaries: number[] = [];
  for (let c = 0; c < cols; c++) {
    boundaries.push(vid(0, c, cols));
    boundaries.push(vid(rows - 1, c, cols));
  }
  for (let r = 1; r < rows - 1; r++) {
    boundaries.push(vid(r, 0, cols));
    boundaries.push(vid(r, cols - 1, cols));
  }
  return { rows, cols, edges, boundaries, events: [] };
}

export interface ValidationIssue {
  code:
    | 'duplicate_event'
    | 'event_out_of_grid'
    | 'boundary_out_of_grid'
    | 'nonpositive_cost'
    | 'edge_not_adjacent'
    | 'event_count'
    | 'unreachable_terminal'
    | 'no_feasible_matching'
    | 'odd_count';
  /** 面向用户的中文定位描述 */
  message: string;
  /** 相关格点/边，供界面高亮 */
  vertex?: number;
  edge?: [number, number];
  /** 录入顺序下标（事件类问题） */
  eventIndex?: number;
}

/** 结构校验：重复事件、越界边界、非正边代价等，逐项定位。 */
export function validateStructure(m: GridModel): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const total = m.rows * m.cols;
  const inGrid = (v: number) => Number.isInteger(v) && v >= 0 && v < total;

  if (!Number.isInteger(m.rows) || !Number.isInteger(m.cols) || m.rows < 1 || m.cols < 1) {
    issues.push({ code: 'event_count', message: '网格行列数必须为正整数' });
  }

  // 边
  for (const [key, w] of Object.entries(m.edges)) {
    const [a, b] = parseEdgeKey(key);
    if (!inGrid(a) || !inGrid(b)) {
      issues.push({ code: 'edge_not_adjacent', message: `边 ${a}–${b} 的端点越出网格`, edge: [a, b] });
      continue;
    }
    if (!areAdjacent(a, b, m.cols, m.rows)) {
      issues.push({
        code: 'edge_not_adjacent',
        message: `边 ${a}–${b} 不相邻（仅允许正交相邻格点间的边）`,
        edge: [a, b]
      });
    }
    if (!Number.isInteger(w) || w <= 0) {
      issues.push({
        code: 'nonpositive_cost',
        message: `相邻格 ${a}–${b} 的边代价 ${w} 不是正整数`,
        edge: [a, b]
      });
    }
  }

  // 边界
  const seenBoundary = new Set<number>();
  for (const v of m.boundaries) {
    if (!inGrid(v)) {
      issues.push({ code: 'boundary_out_of_grid', message: `边界格点 ${v} 越出网格（共 ${total} 个格点，编号 0..${total - 1}）`, vertex: v });
      continue;
    }
    if (seenBoundary.has(v)) {
      issues.push({ code: 'boundary_out_of_grid', message: `边界格点 ${v} 重复登记`, vertex: v });
    }
    seenBoundary.add(v);
  }

  // 事件
  const seenEvent = new Map<number, number>();
  m.events.forEach((v, i) => {
    if (!inGrid(v)) {
      issues.push({
        code: 'event_out_of_grid',
        message: `第 ${i + 1} 个录入事件位于格点 ${v}，越出网格（编号 0..${total - 1}）`,
        eventIndex: i,
        vertex: v
      });
      return;
    }
    if (seenEvent.has(v)) {
      issues.push({
        code: 'duplicate_event',
        message: `第 ${i + 1} 个录入事件与第 ${seenEvent.get(v)! + 1} 个事件重复，同位于格点 ${v}`,
        eventIndex: i,
        vertex: v
      });
    } else {
      seenEvent.set(v, i);
    }
  });
  if (m.events.length < MIN_EVENTS || m.events.length > MAX_EVENTS) {
    issues.push({
      code: 'event_count',
      message: `检测事件须为 ${MIN_EVENTS}–${MAX_EVENTS} 个，当前 ${m.events.length} 个`
    });
  }
  return issues;
}
