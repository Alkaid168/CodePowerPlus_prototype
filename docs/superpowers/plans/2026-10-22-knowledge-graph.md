# Knowledge Graph Implementation Plan

> **For agentic workers:** Use subagent-driven-development for independent content/API/math tasks; primary agent integrates and verifies the complete page.

**Goal:** 实现全部叶子的知识图谱，包含弹性圆球与固定科技树两个完整视图。

**Architecture:** 分类词表保持不变，单独版本化硬前置关系；只读API输出全叶子图；原生Canvas与纯JS数学模块实现交互和固定布局。

**Tech Stack:** FastAPI、Python、原生ES modules、Canvas 2D、pytest、Node、真实浏览器。

**Spec:** `docs/superpowers/specs/2026-10-22-knowledge-graph-design.md`

## Global Constraints

- 使用现有黑白灰token、控件与侧栏；“知识图谱”紧随“知识树”。
- 保留全部既有采集/评分未提交改动；原词表、作者笔记、正式数据库不变。
- 节点精确等于全部叶子，硬前置必须有理由，允许无边节点；机器编纂与教师审核区分。
- 本地原生模块，无运行时CDN，不提交推送。用户已授权本轮实现和子代理。

## Task 1: 关系内容

- [x] 读取全部叶子与介绍，按必需基础逐项编纂`data/knowledge_graph.json`。
- [x] 校验引用、DAG、重复、自环和冗余；记录排除的错误关系和粒度缺口。
- [x] 交付`docs/knowledge-graph-content-2026-10-22.md`，来源和审核边界明确。

## Task 2: 只读图接口

- [x] 先写临时图失败用例、全部叶子/API只读用例并运行确认。
- [x] 实现`load_graph(taxonomy,path=None)`及`GET /api/knowledge/graph`，在知识通配路由前注册。
- [x] 运行严格元数据、非叶子、环、重复、版本、正常图与API相关测试。

## Task 3: 可验证布局与物理

- [x] 用Node行为测试先验证尚未存在的数学模块。
- [x] 实现createSimulation/stepSimulation/layoutTechTree/fitCamera/zoomCamera/screenToWorld。
- [x] 验证337节点稳定、拖动固定、全部节点保留、固定视图不重叠且箭头向下、相机缩放不漂移。

## Task 4: 页面与交互整合

- [x] 添加Canvas绘制与手势、节点详情、搜索、领域过滤、两种视图控件与资源释放。
- [x] 注册导航、API封装、样式入口和页面路由。
- [x] 更新最终前端模板记录经用户授权的图谱页面规范。
- [x] 真实浏览器核对拖甩/平移/缩放、固定树滚动、搜索、切页、窄屏和减少动态。

## Task 5: 完整验收

- [x] 整合内容/API/数学模块，独立核对语义争议边，修正实测问题。
- [x] 隔离完整pytest与ES模块语法；补必要交互回归和截图证据。
- [x] 核对原词表/作者笔记保护指纹及数据库隔离；更新四份长期记录；保持工作区可审阅。

## 完成证据

内容337/189；347 pytest、17 Node、30模块语法通过；真实Edge多尺寸/手势/IME/定位/减少动态/离页回归通过，独立修后复审无新增问题。详见`docs/knowledge-graph-implementation-2026-10-22.md`与本地浏览器JSON。
