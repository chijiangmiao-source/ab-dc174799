// @vitest-environment node
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { AppState } from '../src/ui/state';
import { defaultGrid } from '../src/solver/model';
import { solve } from '../src/solver/solve';

/** 可控的 Worker mock：postMessage 只暂存请求，手动 flush 才回送结果。 */
let pendingWorkers: MockWorker[] = [];

class MockWorker {
  req: any = null;
  terminated = false;
  onmessage: ((e: { data: any }) => void) | null = null;
  constructor(_url: unknown, _opts?: unknown) {
    pendingWorkers.push(this);
  }
  postMessage(req: any) {
    this.req = req;
  }
  terminate() {
    this.terminated = true;
  }
  flush() {
    const outcome = solve(this.req.model);
    this.onmessage?.({ data: { type: 'result', version: this.req.version, outcome } });
  }
}

beforeEach(() => {
  pendingWorkers = [];
  (globalThis as any).Worker = MockWorker;
});
afterEach(() => {
  delete (globalThis as any).Worker;
});

function demoModel() {
  const m = defaultGrid(3, 3);
  m.events = [4, 5]; // 中央两格相邻
  return m;
}

describe('AppState — 求解版本防护', () => {
  it('正常求解：结果版本与草稿一致', () => {
    const s = new AppState(demoModel());
    s.solve();
    expect(s.running).toBe(true);
    pendingWorkers[0].flush();
    expect(s.running).toBe(false);
    expect(s.result?.version).toBe(s.modelVersion);
    expect(s.result?.result?.totalCost).toBe(1);
  });

  it('求解期间改动网格：旧版本结果被丢弃，不覆盖新草稿', () => {
    const s = new AppState(demoModel());
    const v0 = s.modelVersion;
    s.solve(); // v0 在飞
    const v1Worker = pendingWorkers[0];

    // 求解期间修改草稿（关闭自动防抖求解，手动控制）
    s.mutate((m) => {
      m.edges[Object.keys(m.edges)[0]] = 7;
    }, { autosolve: false });
    expect(s.modelVersion).toBe(v0 + 1);
    expect(s.stale).toBe(false); // 尚无任何已落地结果

    // v0 结果迟到：必须丢弃
    v1Worker.flush();
    expect(s.result).toBeNull();
    expect(v1Worker.terminated).toBe(false);

    // 重新求解新版本，新结果正常落地
    s.solve();
    expect(v1Worker.terminated).toBe(true); // 发起新求解时取消旧任务
    const v2Worker = pendingWorkers[1];
    v2Worker.flush();
    expect(s.result?.version).toBe(v0 + 1);
    expect(s.result?.issues).toEqual([]);
  });

  it('取消任务：飞行中结果作废，旧结果不得落地', () => {
    const s = new AppState(demoModel());
    s.solve();
    const w = pendingWorkers[0];
    s.cancel();
    expect(w.terminated).toBe(true);
    expect(s.running).toBe(false);
    w.flush(); // 即便迟到也不落地
    expect(s.result).toBeNull();
  });

  it('结构问题在主线程即时返回，不进 Worker', () => {
    const s = new AppState(defaultGrid());
    s.model.events = [0, 0]; // 重复事件
    s.solve();
    expect(pendingWorkers).toHaveLength(0);
    expect(s.result?.issues.some((i) => i.code === 'duplicate_event')).toBe(true);
  });
});
