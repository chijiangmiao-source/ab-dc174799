/*
 * Web Worker：在后台线程执行求解，避免阻塞校准员的编辑操作。
 * 消息协议：
 *   入：{ type:'solve', runId, spec }
 *   出：{ runId, ok, ... }（求解结果或校验错误；fatal 字段表示内部异常）
 */
'use strict';

importScripts('matching.js', 'solver.js');

self.onmessage = function (e) {
  const data = e.data || {};
  if (data.type !== 'solve') return;
  const runId = data.runId;
  try {
    const result = Solver.solve(data.spec);
    result.runId = runId;
    self.postMessage(result);
  } catch (err) {
    self.postMessage({
      runId: runId,
      ok: false,
      fatal: String((err && err.stack) || err),
    });
  }
};
