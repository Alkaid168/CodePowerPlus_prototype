# 码力加加项目工作计划

全景清单与进度见 `docs/roadmap.md`（按板块列出所有待办、当前状态与证据）。本文只记录当前阶段的执行任务。

## 当前执行任务（2026-09-13 用户明确授权）

### 前后端整体重写（已完成）

- [complete] 后端分层：`db / repositories / services / api`，统一错误与响应契约
- [complete] 前端重写：3 个 CSS + 16 个 ES 模块，`h()` 建节点，无 npm 构建
- [complete] 测试重写：101 项（含数据库兼容、审核流程、画像推荐、静态资源回归）
- [complete] 文档与工具：`docs/architecture.md`、`scripts/smoke_test.py`、README、`.env.example`
- [pending] 用真实题目做一轮标注，收集“标不进去 / 太粗 / 太细”的反馈并调整词表
- [pending] 接入题库数据导入（公开题库或学校平台导出）
- [pending] 补浏览器端自动化测试（当前只有接口测试与前端模块检查）

完整设计：docs/superpowers/specs/2026-09-13-knowledge-system-design.md。
执行计划：docs/superpowers/plans/2026-09-13-knowledge-system.md。

- [complete] 1. 正式规范与字段标准
- [complete] 2. 完整 L1/L2/L3 基线
- [complete] 3. 核心知识标准化内容
- [complete] 4. JSON Schema 与启动校验
- [complete] 5. 分析标签校验与版本记录
- [complete] 6. 知识树查询与详情接口
- [complete] 7. 图谱画像、推荐与路径
- [complete] 8. 人工审核接口
- [complete] 9. 导入、导出和版本迁移
- [complete] 10. 标注集、推荐实验和评估
- [complete] 11. UI 知识树、解释和学习路径

用户长期背景及协作偏好见 PROJECT_MEMORY.md。下方旧阶段记录保留供追溯，不作为当前完成证明。

## 总目标
在大创周期内完成一个可运行的程序设计智能辅导原型，并围绕题目分析、能力画像、辅导和推荐开展可验证的改进实验。

## 阶段
- [complete] 阅读资料与确认约束
- [in_progress] 中期答辩前：最小规模原型
- [pending] 原型评估与研究指标设计
- [pending] 后半期模块改进实验
- [pending] 系统联调、材料与验收

## 中期原型范围
1. 题目导入：先支持 JSON/CSV/手工录入，准备少量公开题目。
2. 题目分析：DeepSeek 输出严格 JSON，包括知识点、难度、题型、解释和置信度。
3. 用户记录：导入或手工录入 AC/WA/TLE、尝试次数、题目标签。
4. 能力画像：先使用可解释的规则/加权模型，输出知识点掌握度和总体水平。
5. 推荐：按掌握度、难度差和未练习状态推荐题目。
6. 辅导：输入题目、代码和评测结果，输出分级提示，默认不直接给完整代码。
7. 简单 Web 界面和 API，保证可以现场操作而非静态演示。

## 技术路线建议
- 后端：Python + FastAPI。
- 数据库：开发期 SQLite，后续可迁移 PostgreSQL。
- 前端：先用简单 HTML/JavaScript 或轻量 React 页面。
- 模型：DeepSeek API；所有模型输出经过 JSON Schema 校验和失败重试。
- 部署：开发期直接运行；稳定后用 Docker，Nginx 只在需要公网 HTTPS/反向代理时加入。
- 数据：公开题目、人工构造提交记录、用户自己在 OJ 可见的数据；不绕过登录或访问权限。

## 后半期研究改进
- 比较不同提示词、模型和结构化约束对标签/难度准确率的影响。
- 比较规则能力模型与知识追踪模型（如 BKT/简化 KT）的推荐效果。
- 设计离线数据集、准确率/一致性/覆盖率/推荐命中率和用户问卷指标。
- 增加题目知识树、代码 AST 特征和更细粒度辅导策略。

## 待确认事项
- 中期答辩具体日期和必须展示的功能。
- 团队三人分工与可投入时间。
- 是否允许使用公开题库 API，还是只准备少量手工题目。

## 错误记录
暂无

- 已获负责人同意总体规划，完成第一版系统设计，等待评审后实现。

- [complete] 第一版题目分析、存储、提交、画像、推荐、辅导和网页原型
- [complete] 测试、配置、Docker 与文档收尾


## 后续扩充任务

- [abandoned] v2026.09.4 的模板批量扩充：301 个占位节点无法用于标注，已整体删除
- [abandoned] v2026.09.5 的“逐节点写讲解与前置”路线：题目打标签不需要描述字段与前置图
- [complete] v2026.09.6：对齐 OI Wiki 栏目的纯标签词表，382 节点（9 L1 / 170 L2 / 203 L3），字段只有 id/name/level/parent_id
- [complete] v2026.09.7：342 个叶子知识点各补一段 50–200 字介绍（summary，界面上展示，不参与标注）
- [complete] 重新运行知识校验、全量测试和离线实验
- [pending] 用真实题目做一轮标注，把“标不进去 / 标签太粗 / 标签太细”的节点反馈回目录

## 桌面端工作台 UI 模板库

- [complete] 明亮通透、黑白灰、无渐变的组件视觉方向
- [complete] 输入、选择、按钮、状态、数据、导航、弹层、代码与 AI 组件规范
- [complete] 动效、响应式、减少动态与可访问性规则
- [complete] `docs/design/` 可复用文档、令牌和预览图
- [pending] 页面布局、工作台骨架与响应式栅格
- [pending] 按模板库在独立前端任务中实现

## 2026-09-14 总览实现

- [complete] 方案 A · Paper 总览视觉
- [complete] 全局黑白灰 token、白色应用外壳和基础组件替换
- [complete] 真实接口数据与空状态
- [complete] 10 个路由回归、响应式、焦点和减少动态自检
- [pending] 总览的视觉微调与真实内容验收
- [pending] 其他业务页面的布局重做

## 2026-09-14 全局模板更新

- [complete] 透明 LOGO 提取与品牌区替换
- [complete] 侧栏清理、顶栏去英文眉题、固定顶栏和主体独立滚动
- [complete] 全页面卡片入场动效与减少动态降级
- [complete] 总览小字精简和桌面无滚动优化
- [complete] 设计要求写入 `docs/design/`，供后续对话复用
- [pending] CodePowerPlus 艺术字体最终选型

- [complete] 总览收敛为极简结构：三项指标 + 当前建议 + 薄弱知识点

- [complete] 移除顶部栏，页面标题并入主体
- [superseded] 总览曾改为背景平铺布局，后被白色气泡卡片版本覆盖
- [complete] 删除重复入口、流程和状态模块，只保留三项指标、建议和薄弱知识点

- [complete] 左侧栏放大到 260px、黑色文字和 44px 行高
- [superseded] 黑色主建议卡因视觉过重已废弃，改为白底 + 浅灰内嵌区
- [complete] 保持无顶部栏并填满桌面主体

- [superseded] 无顶栏平铺方案已被 XEPT 轻量白卡方案覆盖

- [complete] 左侧栏字体与 XEPT 对齐，导航字重改为常规
- [complete] 总览恢复气泡卡片并铺满标准桌面
- [complete] 总览增加“已有题目”状态

## 2026-09-14 XEPT 轻量白卡（最新）

- [complete] 取消总览黑色主建议卡，改为单一白色横向主卡，删除右侧灰色内嵌卡片与 Logo
- [complete] Primary 按钮恢复原有黑底白字，Hover 使用纯黑
- [complete] 保留 260px 侧栏、无顶部栏、12px 卡片圆角和 1440×900 铺满规则
- [complete] 更新空数据与已有题目两张参考图及设计交接文档
- [complete] 110 项 pytest、前端语法、10 路由、响应式和减少动态回归通过

## 2026-09-14 按钮修正

- [complete] 保留白色主建议卡，仅将“记录提交”和主卡主动作恢复为黑底白字
- [complete] Secondary 按钮继续使用白底和 1px 灰边界

## 2026-09-14 前端最终模板

- [complete] 建立 `docs/design/FINAL_FRONTEND_TEMPLATE.md` 作为后续前端唯一权威参考
- [complete] 更新 `AGENTS.md`、`README.md` 和 `handoff.md` 的强制阅读入口
- [complete] 归档总览空数据与有题目两张最终参考图


## 2026-09-14 知识树页面（当前阶段）

用户改为按功能逐个推进：先页面与后端对齐一个功能，再进入下一个。第一个功能是知识树页面。

- [complete] 现状核对：后端 `/api/knowledge/tree`、`/search`、`/{id}` 已够用（382 节点、133 KB），本页是纯前端任务
- [complete] 实施计划与交接提示：`docs/superpowers/plans/2026-09-14-knowledge-tree-page.md`
- [in_progress] 任务 1：知识树页面按最终模板重做（由独立前端对话执行）
- [pending] 任务 2：验收与归档，含参考图与模板章节更新（总控对话）
- [pending] 任务 3：知识点题目数统计（等题库有 20–30 道真实题目后再做）

## 2026-09-14 知识树页面实现与验收（完成）

- [complete] 新增 `knowledge.css`，重写 `knowledge.js` 为双栏知识词表与详情页
- [complete] 实现本地搜索、层级筛选、展开全部/折叠全部、完整路径和叶子说明
- [complete] 1440×900、1280×800、1024px 浏览器布局验收
- [complete] 控制台、键盘操作、reduced-motion、静态回归与全量测试验收
- [pending] 等有真实题目后，再为知识节点补充已标注题目数量和题目列表

## 2026-09-14 知识树 OI Wiki 风格修订（完成）

- [complete] 删除页面标题、词表统计、领域说明和全部筛选按钮
- [complete] 顶部改为 L1 领域导航，搜索框右置并改为“搜索知识点”
- [complete] 左侧仅显示当前 L1 的 L2/L3，统一白色条目并移除等级标注
- [complete] L3 长条与箭头圆点同步缩进
- [complete] 右侧移除等级、ID、用途说明，L2 仅保留下级节点分隔列表

### 2026-09-14 知识树叶子与下级列表修正（完成）

- [complete] L2/L3 叶子节点均显示知识点介绍
- [complete] 删除“下级节点”标题及其顶部横线
- [complete] 下级列表继续使用横向分隔线

### 2026-09-14 L1 知识插画（完成）

- [complete] 9 个 L1 各绘制一张黑色线条 SVG
- [complete] L1 详情移除下级目录并展示对应插画
- [complete] 浏览器逐张检查、页面参考图与项目记录同步

## 2026-09-17 知识体系 v2026.09.8 标签清理（完成）

- [complete] 删除不适合作为题目标签的 Wiki 章节式节点
- [complete] 拆分为前缀和/差分，DFS/BFS 改为中文括号英文，重新整理数学、图论和数据结构节点
- [complete] 为所有新叶子及由分支变为叶子的节点补齐 50–200 字介绍
- [complete] 同步 `2026.09.8` 快照、测试、离线评估夹具和报告
- [pending] 根据审查建议，决定是否继续删除少量仍然偏理论的候选节点

## 2026-09-17 知识体系 v2026.09.9 后续清理（完成）

- [complete] 删除 `math.coordinate`，将坐标系与弧度说明并入二维计算几何
- [complete] 将 `math.numeral-system` 改为“进位制”，原“进位制”子节点改为“进制转换”
- [complete] 删除 `misc.space-optimization`
- [complete] 更新快照、测试、离线评估夹具与运行版本

## 2026-09-21 知识树提交前检查

- [complete] 全量验证：123 项 pytest、19 个前端模块语法、10 路由控制台、三种宽度布局
- [complete] 修复深链接不同步：`#/knowledge/<id>` 现在同时切换 L1、展开祖先并高亮当前行
- [complete] `.gitignore` 与文档数字整理
- [in_progress] 提交并合并到 main，推送 GitHub
### 2026-09-21 GitHub 推送

- [complete] 添加 origin 并推送 main：`07ea38b`，远端默认分支为 main
## 2026-09-21 下一步建议：先跑真实数据闭环

当前状态：题库 0 题、0 提交、0 审核；知识体系 2026.09.9 共 345 节点已定稿；总览与知识树页面已定稿并推送 GitHub。

建议顺序（理由：数据是设计的前提，刚定稿的词表越早被真题检验越便宜）：

1. **[in_progress] 喂 5 道真实题目，跑通 录入 → 分析 → 审核 → 提交 → 画像 → 推荐**
   - 公开题库选 5 道，覆盖模拟/贪心、DP、图论最短路、字符串、数论
   - 每题记录三件事：模型标了什么、人工认为该标什么、词表里有无合适节点
   - 已实测：`/api/problems/analyze` 能正常调用 DeepSeek 并返回合法标签（探针题：差分+前缀和）
2. **[pending] 页面按数据流顺序定稿**：题目库 + 题目分析 → 审核队列 → 提交记录 → 能力画像 → 学习路径 + 推荐训练 → 代码辅导
3. **[pending] CI**：新增 GitHub Actions，跑 `pytest` 与前端 `node --check`
4. **[pending] 向教练确认中期答辩日期**：roadmap 目前按 2026 年 12 月预留

## 2026-09-21 题目录入与分析模块重做（完成）

用户要求前后端重做第四个页面，目标是基本可日常使用。

- [complete] 难度改为 Codeforces 风格 800–3500 评分，锚点按用户给定值展开成八档
- [complete] 题面改为 Markdown，前端本地 vendored marked + MathJax，正确排版 LaTeX
- [complete] 题目编号从 1000 起自动分配（`MAX(id)+1`，不依赖 AUTOINCREMENT）
- [complete] 来源改为可选的 `source_url`，旧库 `source` 自动改名迁移
- [complete] 录入即调用模型分析（建题 + 分析两步接口，模型失败保留题目）
- [complete] 删除「同一 L2 分支最多一个主标签」规则，支持等价解法全部标注
- [complete] 系统提示词 `problem-analysis-v4` 交用户审阅（未收到修改意见前不再改动）
- [complete] 前端页面重做为左录入右结果双栏工作台（四个 Tab）
- [complete] 145 项 pytest、前端语法检查、浏览器全流程与三种宽度验收
- [pending] 用真实题目批量跑一轮，收集难度评分与标签覆盖的反馈
- [pending] 难度评分校准：需要人工标注样本做回归，当前只有负责人给的锚点
- [pending] 后续页面按同一模板重做（审核队列 → 提交记录 → 画像 → 推荐 → 辅导）
