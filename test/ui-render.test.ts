// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { state } from '../src/ui/state';
import { renderGrid } from '../src/ui/renderer';
import { renderInspector } from '../src/ui/inspector';
import { defaultGrid, validateStructure } from '../src/solver/model';
import { solve } from '../src/solver/solve';

function demo() {
  const m = defaultGrid(3, 5);
  m.boundaries = [];
  for (let c = 0; c < 5; c++) {
    m.boundaries.push(c);
    m.boundaries.push(2 * 5 + c);
  }
  m.events = [1 * 5 + 1, 1 * 5 + 2];
  return m;
}

describe('UI 渲染冒烟（jsdom）', () => {
  beforeEach(() => {
    state.replaceModel(demo(), { autosolve: false });
    state.result = null;
    state.running = false;
    state.selectChain(null);
  });

  it('格图 SVG 渲染：格点、边界、事件、边齐全', () => {
    const wrap = document.createElement('div');
    document.body.appendChild(wrap);
    renderGrid(wrap, { showCosts: true, showIds: false });
    const svg = wrap.querySelector('svg')!;
    expect(svg).toBeTruthy();
    const texts = [...svg.querySelectorAll('text')].map((t) => t.textContent);
    expect(texts).toContain('1');
    expect(texts).toContain('2');
    // 边界方块：上下两行共 10 个 rect（边代价标签背景 rect 不存在，因为 showCosts 的 rect 也计入；
    // 这里边界方块恰为 10，边为水平/垂直，标签 rect 也会出现——故只断言边界方块不少于 10）
    expect(svg.querySelectorAll('rect').length).toBeGreaterThanOrEqual(10);
  });

  it('侧栏在有结果时渲染总代价、链清单与逐边代价', () => {
    const outcome = solve(state.model);
    expect(outcome.issues).toEqual([]);
    state.result = { version: state.modelVersion, ...outcome };

    const root = document.createElement('div');
    renderInspector(root);
    expect(root.textContent).toContain('总代价');
    expect(root.querySelectorAll('.chain-card')).toHaveLength(1);
    expect(root.querySelectorAll('.edge-list li')).toHaveLength(1);
  });

  it('点选事件：侧栏出现“连接依据”，说明成对优于两条边界链', () => {
    state.result = { version: state.modelVersion, ...solve(state.model) };
    const root = document.createElement('div');
    state.selectChain(0, 0);
    renderInspector(root);
    expect(root.textContent).toContain('连接依据');
    expect(root.textContent).toContain('事件对');
    // 两条边界合计 2、成对 1
    expect(root.textContent).toMatch(/合计[\s\S]*?2/);
    expect(root.textContent).toContain('1');
  });

  it('问题定位：重复事件渲染可点击的错误条目', () => {
    state.mutate(
      (m) => {
        m.events = [0, 0];
      },
      { autosolve: false }
    );
    state.result = { version: state.modelVersion, issues: validateStructure(state.model) };
    const root = document.createElement('div');
    renderInspector(root);
    const issue = root.querySelector('.issue')!;
    expect(issue).toBeTruthy();
    expect(issue.textContent).toContain('重复');
  });
});
