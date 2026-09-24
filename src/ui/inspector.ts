/**
 * 侧栏检视面板：
 * 求解状态与陈旧提示、错误定位列表、链清单（端点 + 逐边代价）、
 * 点选事件后的“连接依据”说明（成对链 vs 两条最近边界链的成本对比）。
 */
import { state } from './state';
import { rowOf, colOf } from '../solver/model';
import { Chain } from '../solver/solve';

export function renderInspector(root: HTMLElement): void {
  root.textContent = '';
  const m = state.model;
  const pos = (v: number) => `(${rowOf(v, m)},${colOf(v, m)})`;
  const evLabel = (i: number) => `事件#${i + 1}@格${m.events[i]} ${pos(m.events[i])}`;

  // ---- 求解状态 ----
  const status = document.createElement('div');
  if (state.running) {
    status.innerHTML = `<span class="spinner"></span> <span style="margin-left:6px">Worker 求解中…</span>`;
  } else if (state.stale) {
    status.innerHTML = `<span class="badge stale">结果已过期</span> <span class="muted" style="margin-left:6px">草稿有改动，等待新求解</span>`;
  } else if (state.result && state.result.issues.length === 0) {
    status.innerHTML = `<span class="badge ok">现行结果</span> <span class="muted" style="margin-left:6px">与当前草稿一致</span>`;
  }
  root.appendChild(status);

  // ---- 错误列表 ----
  const issues = state.result?.issues ?? [];
  if (issues.length) {
    const h = sectionTitle(`问题定位（${issues.length}）`);
    root.appendChild(h);
    for (const is of issues) {
      const div = document.createElement('div');
      div.className = 'issue';
      div.innerHTML = `<span class="ico">⚠</span><span>${is.message}</span>`;
      if (is.vertex !== undefined || is.edge) {
        div.title = '点击在格图中定位';
        div.addEventListener('click', () => state.locate(is.vertex, is.edge));
      }
      root.appendChild(div);
    }
  }

  // ---- 选中事件的连接依据 ----
  const selEv = state.selectedEvent;
  if (selEv !== null && state.result?.result) {
    const chain = state.result.result.chains.find((c) => c.eventA === selEv || c.eventB === selEv);
    if (chain) {
      root.appendChild(sectionTitle('连接依据'));
      const box = document.createElement('div');
      box.className = 'rationale';
      if (chain.kind === 'pair') {
        const other = chain.eventA === selEv ? chain.eventB! : chain.eventA;
        const a = chain.eventANearestBoundary;
        const b = chain.eventBNearestBoundary;
        let cmp: string;
        if (a !== null && b !== null) {
          cmp = `两条各自连向最近边界的链合计 <b class="mono">${a + b}</b>，成对链仅 <b class="mono">${chain.cost}</b>，故${chain.cost <= a + b ? '选择事件对' : '应选边界'}。`;
        } else {
          cmp = `至少一个事件没有可达边界，只能以事件对消去。`;
        }
        box.innerHTML = `
          <div><b>${evLabel(selEv)}</b> 与 <b>${evLabel(other)}</b> 构成成对链。</div>
          <div style="margin-top:4px">${cmp}</div>
          <div class="muted" style="margin-top:4px">最短链由 Dijkstra 在格图上求出；是否成对由最小权完美匹配（Blossom）全局决定，而非就近连边界。</div>`;
      } else {
        box.innerHTML = `
          <div><b>${evLabel(selEv)}</b> 连向边界格 <b class="mono">${chain.boundary} ${pos(chain.boundary!)}</b>。</div>
          <div style="margin-top:4px">到最近边界代价 <b class="mono">${chain.cost}</b>；该事件以边界链消去是全局最优匹配的一部分。</div>`;
      }
      root.appendChild(box);
    }
  }

  // ---- 结果汇总与链清单 ----
  const r = state.result?.result;
  if (r && issues.length === 0) {
    root.appendChild(sectionTitle('匹配结论'));
    const sum = document.createElement('div');
    sum.className = 'kv';
    const pairs = r.chains.filter((c) => c.kind === 'pair').length;
    const bnds = r.chains.filter((c) => c.kind === 'boundary').length;
      sum.innerHTML = `
      <dt>总代价</dt><dd class="mono" style="font-size:16px;color:var(--accent-2)">${r.totalCost}</dd>
      <dt>事件对链</dt><dd>${pairs} 条（消去 ${pairs * 2} 个事件）</dd>
      <dt>边界链</dt><dd>${bnds} 条（消去 ${bnds} 个事件）</dd>
      <dt>覆盖</dt><dd>${pairs * 2 + bnds} / ${m.events.length} 个事件，互不重复</dd>`;
    root.appendChild(sum);

    root.appendChild(sectionTitle('逐链明细（点击在图中高亮）'));
    for (const ch of r.chains) {
      root.appendChild(chainCard(ch, pos));
    }
  }
}

function sectionTitle(text: string): HTMLElement {
  const h = document.createElement('h2');
  h.className = 'section';
  h.textContent = text;
  return h;
}

function chainCard(
  ch: Chain,
  pos: (v: number) => string
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'chain-card' + (ch.id === state.selectedChainId ? ' selected' : '');
  const head = document.createElement('div');
  head.className = 'chain-head';
  const ends = document.createElement('div');
  ends.className = 'chain-ends';
  if (ch.kind === 'pair') {
    ends.innerHTML = `<span class="badge pair">事件对</span>
      <span style="margin-left:6px">#${ch.eventA + 1} ⟷ #${ch.eventB! + 1}</span>
      <div class="muted">格 ${ch.vertices[0]} ${pos(ch.vertices[0])} → 格 ${ch.vertices[ch.vertices.length - 1]} ${pos(ch.vertices[ch.vertices.length - 1])}</div>`;
  } else {
    ends.innerHTML = `<span class="badge boundary">边界链</span>
      <span style="margin-left:6px">#${ch.eventA + 1} → 边界格 ${ch.boundary}</span>
      <div class="muted">格 ${ch.vertices[0]} ${pos(ch.vertices[0])} → 格 ${ch.boundary} ${pos(ch.boundary!)}</div>`;
  }
  const cost = document.createElement('div');
  cost.className = 'chain-cost';
  cost.textContent = `Σ ${ch.cost}`;
  head.appendChild(ends);
  head.appendChild(cost);
  card.appendChild(head);

  // 逐边代价
  const ol = document.createElement('ol');
  ol.className = 'edge-list';
  ch.edges.forEach((e, i) => {
    const li = document.createElement('li');
    li.innerHTML = `边 <b class="mono">${e.from}–${e.to}</b> ${pos(e.from)}→${pos(e.to)}：代价 <b class="mono">${e.cost}</b>`;
    li.addEventListener('mouseenter', () => state.locate(undefined, [e.from, e.to]));
    li.addEventListener('mouseleave', () => state.locate(undefined, undefined));
    ol.appendChild(li);
    void i;
  });
  card.appendChild(ol);

  card.addEventListener('click', () => {
    state.selectChain(ch.id === state.selectedChainId ? null : ch.id, ch.eventA);
  });
  return card;
}
