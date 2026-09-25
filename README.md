# 超导量子芯片纠错链复核台

每轮读出产生的检测事件需要由互不重复的纠错链消去：事件两两配对，或经最短链
连向可作终点的边界。若把每个事件机械地连向最近边界，可能错过总代价更低的
成对解释。本系统在浏览器内以**精确整数最小权完美匹配**求出总代价最小的链集，
并在同成本时输出规范结论，供校准员复核。

## 功能

- **可编辑规格**：矩形码格（1–60 行/列）、相邻格间正整数代价、可作终点的
  边界格、2–48 个检测事件；支持 JSON 导入/导出。
- **精确求解（Web Worker 内）**：
  1. 每个事件一次 Dijkstra，得到事件间与事件到边界的最短链；
  2. 归约为一般图最小权完美匹配——每个事件一个节点，另为每事件设一个
     虚拟边界节点（事件↔其虚拟节点边权=到最近边界距离，虚拟节点两两零权
     相连），用 Edmonds 开花算法（原始-对偶，全程精确整数运算）求解；
  3. 不使用贪心、逐事件最近边界或枚举配对。
- **规范结论**：总代价相同的解之间，按事件录入顺序逐项比较链向量——
  “边界优先、随后另一端标识升序”——取字典序最小者，输出稳定确定。
- **结果页**：格图上绘制每条链，列出端点与逐边代价；点选事件查看连接依据
  （其候选连接距离、全局最优说明），并对比“机械连最近边界”的总代价。
- **错误定位**：重复事件、越界边界、非正边代价、无可达终点（连通区域无边界
  且事件数为奇）均给出定位提示，可在格图上高亮。
- **防陈旧**：求解期间改动网格或取消任务时，旧结果不会覆盖新草稿或新结果
  （每次求解携带运行号与编辑代次，返回时双重校验，不符即丢弃）。

## 运行

```bash
# 本地（Node 20+，无第三方依赖）
npm start                 # 默认 8080 端口
PORT=9000 npm start       # 自定义端口

# Docker Compose（网页端口可用 WEB_PORT 配置，默认 8080）
WEB_PORT=8080 docker compose up web
# 打开 http://localhost:8080 ；健康检查：curl http://localhost:8080/healthz
```

## 一次性验收（verify 服务）

```bash
docker compose up --exit-code-from verify --abort-on-container-exit verify
echo $?   # 0 = 全部通过，1 = 存在失败项
```

verify 服务一次性执行并以退出码报告结果：

1. **验收场景**：在“局部最近边界并非全局最优”的格图（机械连边界总代价 3，
   事件配对总代价 1）中确认求解器选择事件配对链而非两条边界链；
2. **匹配代码测试**：开花算法与暴力枚举在 3000+ 组随机图上对拍，另有
   400 组归约形状专项与求解器端到端对拍（代价与规范向量均一致）；
3. **构建检查**：全部 JS 语法检查、必需文件与页面资源引用完整性、
   Compose 配置要点（可配置端口 /healthz / verify 服务）；
4. **HTTP 冒烟**：`/healthz`、首页、Worker 与算法脚本、404 与目录穿越防护。

本地不依赖 Docker 亦可执行：`node verify.js`（自动拉起临时服务器做冒烟）。
单元测试：`npm test`。

## 目录结构

```
server.js            静态服务器 + /healthz（PORT 环境变量）
src/matching.js      Edmonds 开花算法最小权完美匹配（UMD，Worker/Node 通用）
src/solver.js        网格模型、校验、Dijkstra、归约、规范化、链重建（UMD）
src/worker.js        Web Worker 胶水层
public/              页面（index.html / app.js / style.css）
test/                匹配、求解器、场景、Worker 协议测试与暴力基准
verify.js            一次性验收服务入口
Dockerfile           单镜像（含 HEALTHCHECK）
docker-compose.yml   web（可配置网页端口）+ verify（一次性验收）
```

## 接口与协议

- `GET /healthz` → `{"status":"ok", ...}`；其余路径为静态资源。
- Worker 消息：入 `{type:'solve', runId, spec}`，出 `{runId, ok, ...}`
  （`ok:false` 时含 `errors`，每项含 `code/message/at` 定位信息）。
- 规格 JSON：`{rows, cols, hCosts[r][c], vCosts[r][c], boundaries:[[r,c]..], events:[[r,c]..]}`，
  边代价缺省为 1。
