/// <reference lib="webworker" />
/**
 * 求解 Web Worker：
 * 最短链（Dijkstra）与一般图最小权完美匹配（Blossom）全部在后台线程完成，
 * 不阻塞浏览器复核界面。每个求解请求带版本号，主线程据此丢弃过期结果。
 */
import { GridModel } from './model';
import { solve, SolveOutcome } from './solve';

export interface SolveRequest {
  type: 'solve';
  version: number;
  model: GridModel;
}

export interface SolveResponse {
  type: 'result';
  version: number;
  outcome: SolveOutcome;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<SolveRequest>) => {
  const req = ev.data;
  if (req.type !== 'solve') return;
  let outcome: SolveOutcome;
  try {
    outcome = solve(req.model);
  } catch (e) {
    outcome = {
      issues: [
        {
          code: 'no_feasible_matching',
          message: `求解器内部错误：${(e as Error).message}`
        }
      ]
    };
  }
  const res: SolveResponse = { type: 'result', version: req.version, outcome };
  ctx.postMessage(res);
};
