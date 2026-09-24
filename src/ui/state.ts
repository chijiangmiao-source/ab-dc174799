/**
 * 前端状态与 Worker 客户端。
 *
 * 版本与竞态规则：
 *  - 每次改动草稿 modelVersion 自增；Worker 请求携带该版本号。
 *  - 仅当响应版本 === 当前草稿版本时才落地为“现行结果”；过期响应（求解期间
 *    又改了网格）直接丢弃，旧结果绝不覆盖新草稿/新结果。
 *  - 取消任务：terminate 旧 Worker 并新建，飞行中的结果随之作废。
 */
import { GridModel, ValidationIssue, validateStructure, defaultGrid } from '../solver/model';
import { SolveResult } from '../solver/solve';
import type { SolveRequest, SolveResponse } from '../solver/worker';

export interface ActiveResult {
  version: number;
  result?: SolveResult;
  issues: ValidationIssue[];
}

export type Listener = () => void;

export class AppState {
  model: GridModel;
  modelVersion = 0;
  /** 已落地的现行结果（其版本可能落后于草稿版本 → 标记 stale） */
  result: ActiveResult | null = null;
  running = false;
  selectedEvent: number | null = null; // 录入下标
  selectedChainId: number | null = null;
  highlightedVertex: number | null = null;
  highlightedEdge: [number, number] | null = null;
  mode: 'select' | 'edge' | 'boundary' | 'event-add' | 'event-remove' = 'select';

  private workers: Worker[] = [];
  private listeners = new Set<Listener>();
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private generation = 0; // Worker 代数：取消后旧代响应一律丢弃

  constructor(initial: GridModel) {
    this.model = initial;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  /** 结构问题可在主线程即时校验，无需等待 Worker。 */
  structuralIssues(): ValidationIssue[] {
    return validateStructure(this.model);
  }

  /** 修改草稿：版本自增、结果标记陈旧，并防抖触发求解。 */
  mutate(fn: (m: GridModel) => void, opts: { autosolve?: boolean } = { autosolve: true }): void {
    fn(this.model);
    this.modelVersion++;
    // 旧结果版本落后，UI 按 stale 显示；求解返回前不覆盖它。
    this.selectedEvent = null;
    this.selectedChainId = null;
    this.emit();
    if (opts.autosolve !== false) this.scheduleSolve();
  }

  private newWorker(): Worker {
    const w = new Worker(new URL('../solver/worker.ts', import.meta.url), { type: 'module' });
    this.workers.push(w);
    return w;
  }

  scheduleSolve(delay = 250): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.solve(), delay);
  }

  /** 立即发起一次求解；若已有任务在跑，先取消（旧结果不得覆盖新结果）。 */
  solve(): void {
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
    // 先取消任何在飞任务（其迟到结果由版本/代次过滤，线程在此释放）。
    this.cancelRunning();
    // 结构问题无需进 Worker，直接给出现行（错误）结果。
    const issues = validateStructure(this.model);
    if (issues.length) {
      this.result = { version: this.modelVersion, issues };
      this.running = false;
      this.emit();
      return;
    }
    const gen = ++this.generation;
    const version = this.modelVersion;
    const worker = this.newWorker();
    this.running = true;
    this.emit();
    worker.onmessage = (ev: MessageEvent<SolveResponse>) => {
      const res = ev.data;
      // 旧代（已取消）或过期版本（求解期间草稿又被改动）：丢弃。
      if (gen !== this.generation || res.version !== this.modelVersion) return;
      this.workers = this.workers.filter((x) => x !== worker);
      worker.terminate();
      this.running = false;
      this.result = { version, ...res.outcome };
      this.emit();
    };
    const req: SolveRequest = { type: 'solve', version, model: structuredClone(this.model) };
    worker.postMessage(req);
  }

  /** 取消当前任务并作废飞行结果。 */
  cancelRunning(): void {
    this.generation++;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.running = false;
  }

  cancel(): void {
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
    this.cancelRunning();
    this.emit();
  }

  /** 整体替换草稿（重置示例）：版本自增并重新求解。 */
  replaceModel(model: GridModel, opts: { autosolve?: boolean } = { autosolve: true }): void {
    this.model = model;
    this.modelVersion++;
    this.result = null;
    this.selectedEvent = null;
    this.selectedChainId = null;
    this.highlightedVertex = null;
    this.highlightedEdge = null;
    this.emit();
    if (opts.autosolve !== false) this.scheduleSolve();
  }

  selectChain(chainId: number | null, eventIndex?: number): void {
    this.selectedChainId = chainId;
    this.selectedEvent = eventIndex ?? null;
    this.emit();
  }

  locate(vertex?: number, edge?: [number, number]): void {
    this.highlightedVertex = vertex ?? null;
    this.highlightedEdge = edge ?? null;
    this.emit();
  }

  get stale(): boolean {
    return this.result !== null && this.result.version !== this.modelVersion;
  }
}

export const state = new AppState(defaultGrid());
