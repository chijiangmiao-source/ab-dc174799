/*
 * 暴力枚举完美匹配，用作开花算法移植正确性的基准（仅适合小规模）。
 */
'use strict';

// 返回最小完美匹配代价；不存在完美匹配时返回 null。
function bruteMinPerfectMatching(n, edges) {
  if (n % 2 === 1) return null;
  const W = new Map();
  for (const e of edges) {
    const a = e[0], b = e[1];
    if (a === b) continue;
    const k = a < b ? a + ',' + b : b + ',' + a;
    if (!W.has(k) || e[2] < W.get(k)) W.set(k, e[2]);
  }
  const used = new Array(n).fill(false);
  function rec() {
    let i = 0;
    while (i < n && used[i]) i++;
    if (i === n) return 0;
    used[i] = true;
    let best = Infinity;
    for (let j = i + 1; j < n; j++) {
      if (used[j]) continue;
      const k = i < j ? i + ',' + j : j + ',' + i;
      if (!W.has(k)) continue;
      used[j] = true;
      const rest = rec();
      if (rest !== Infinity && rest + W.get(k) < best) best = rest + W.get(k);
      used[j] = false;
    }
    used[i] = false;
    return best;
  }
  const out = rec();
  return out === Infinity ? null : out;
}

module.exports = { bruteMinPerfectMatching };
