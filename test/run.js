/*
 * 测试入口：匹配代码测试 + 求解器测试 + 验收场景。
 */
'use strict';

const matching = require('./matching.test');
const solver = require('./solver.test');
const scenario = require('./scenario.test');
const worker = require('./worker.test');

function run() {
  const m = matching.run();
  console.log('  matching tests passed', JSON.stringify(m));
  const s = solver.run();
  console.log('  solver tests passed', JSON.stringify(s));
  const sc = scenario.run();
  console.log('  scenario test passed', JSON.stringify(sc));
  worker.run();
  console.log('  worker tests passed');
}

if (require.main === module) {
  run();
  console.log('all tests passed');
}

module.exports = { run };
