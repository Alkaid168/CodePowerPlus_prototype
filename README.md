# CodePowerPlus_prototype

本仓库保存码力加加（CodePowerPlus）的当前原型版本，仓库与工程名称统一为 `CodePowerPlus_prototype`。
应用内名称仍为 CodePowerPlus，页面标题、左上角品牌与功能内容不加 prototype。
GitHub：<https://github.com/Alkaid168/CodePowerPlus_prototype>。

面向算法竞赛训练的智能辅导原型：给题目打知识标签，按标签记录做题证据，生成能力画像，
再据此推荐题目与学习路径。开发与学校 OJ 解耦，不需要 OJ 源码，先用手工与公开数据跑通闭环。

## 四件事

1. **题目录入与分析**：题面用 Markdown（LaTeX 公式可排版），编号从 1000 起自动分配；
   保存后调用模型给出知识点标签、项目难度评分（100–3500）、证据句与置信度。100–700 是 C 语言新生入门阶梯，800 起沿用原算法评分分档。
   新建、题目编辑和手工标注支持本浏览器草稿自动保存，灰色图标提示；刷新／切页可恢复，正式保存仍需点击按钮。
2. **人工审核**：分析先进入待审核，通过后才成为证据；纠正会生成新版本，旧版本与审计记录都保留。
3. **能力画像**：按独立题目的最后一次非 CE 结果估计每个知识点的掌握度。
4. **推荐与路径**：只用当前版本、已审核的题目，按标签薄弱度与难度适配排序。

## 知识图谱

侧栏“知识树”下方的“知识图谱”（`#/knowledge-graph`）显示全部337个叶子与189条前置关系。
支持可拖动、甩动、平移和缩放的弹性视图，以及固定节点、向下滚动的科技树；两种视图共用同一数据。
可按领域筛选、搜索中英文知识点、查看前驱和后继。关系为代理编纂并经过独立代理复核，尚未教师逐边审核，
不会自动修改画像或学习记录。来源与范围见[图谱内容说明](docs/knowledge-graph-content-2026-10-22.md)，
实现与验证见[图谱交付记录](docs/knowledge-graph-implementation-2026-10-22.md)。

## 四平台提交采集与存储

`extensions/collector`提供本机浏览器MV3采集助手，复用本人已登录的平台标签页，支持Codeforces、洛谷、AtCoder和VJudge的提交/可见源码采集、断点恢复、JSON导出和可选分批上传。平台密码与cookie留在本机；AtCoder使用提交副本，覆盖明确标为partial。

服务端导入使用独立SQLite采集库及按用户/平台/账号限定的短期令牌，支持幂等、源码去重、配额、删除与新文件备份恢复。采集结果不会自动写入已审核题目或学习证据；当前是本人数据开发闭环，尚未包含多人自助认证、题面标签难度关联或跨站同题映射。

安装与使用见[采集助手指南](extensions/collector/README.md)、[快速开始](docs/collection-quickstart-2026-10-22.md)与[阶段验收](docs/collection-stage-acceptance-2026-10-22.md)。本轮合并验收见[总控验收记录](docs/module-acceptance-2026-10-22.md)。

## 快速开始

本地统一入口为 `F:\CODES\CodePowerPlus_prototype`，可双击 `start_CodePowerPlus_prototype.bat` 启动。
该入口与原目录 `F:\CODES\CodePowerPlus` 指向同一份文件，保留现有会话与运行环境兼容。

项目自带名为 `CodePowerPlus` 的虚拟环境，也可以自己建一个：

```powershell
CodePowerPlus\Scripts\python.exe -m uvicorn app.main:app --reload
```

浏览器打开 <http://127.0.0.1:8000/>，接口文档在 <http://127.0.0.1:8000/docs>。
第一次使用可以写入几道演示题目：

```powershell
CodePowerPlus\Scripts\python.exe scripts\seed_demo.py
```

从零搭建环境：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
copy .env.example .env
uvicorn app.main:app --reload
```

## 模型是可选的

复制 `.env.example` 为 `.env` 并填写 `DEEPSEEK_API_KEY` 即可调用模型分析题目与生成辅导提示。
没有密钥时系统照样可用：题目分析改用手工标注，代码辅导只返回将要发送的提示词预览。

当前模型分析提示词为 `problem-analysis-v8`，实际执行“解法与标签→独立审查与评分”两次调用；方法知识点必须与最终标签一致，审查发现实质问题会退回重做。人工分析来源版本为 `manual-v2`；旧分析和冻结评估保留原版本。v7已标记**非成品**，v8仍为实验版本，参见[发展历史](docs/development-history.md)、[研究依据](docs/v8-rating-research.md)及[v8首测协议](docs/v8-first-test-protocol.md)。当前知识树版本为 `2026.10.1`，包含语法基础、算法基础等10个领域；700及以下只能用语法标签，800及以上禁止语法标签，核心与辅助同样受校验。语法标签的 `intro_rating` 用于后台最低阶段校验，知识树不显示门槛提示。具体范围与来源见 [C 语言新生语法词表说明](docs/c-syntax-taxonomy-2026-10-16.md)。

## 代码结构

```text
app/
  config.py        配置与路径（环境变量）
  db.py            SQLite 连接、表结构与旧库兼容
  errors.py        领域异常到 HTTP 状态码
  knowledge.py     知识树（题目标签词表）
  schemas.py       请求与响应契约
  repositories.py  数据访问（题目、分析、审核、提交）
  services/        业务规则
    analysis.py      标签校验、模型调用与输出解析
    review.py        审核流程（乐观锁 + 纠正版本）
    profile.py       能力画像公式
    recommend.py     推荐与学习路径
    tutor.py         分级辅导提示
  api/             HTTP 接口（knowledge/problems/reviews/submissions/learners/overview/tutor）
  main.py          应用组装
  static/          前端：css/ 与 js/（ES 模块，无构建步骤）
data/
  knowledge_taxonomy.json        标签词表（377 节点、10 个领域；337 个叶子各带一段 50–200 字介绍）
  knowledge_taxonomy.schema.json JSON Schema
  taxonomy_versions/             版本快照
  evaluation/                    离线评估夹具与报告
scripts/
  seed_demo.py     写入演示题目
  smoke_test.py    端到端自检（不碰正式数据库）
  evaluate.py      离线实验：标签指标与推荐指标
  reassess_problems.py 冻结当前题库、断点重评、备份后原子追加待审核分析
  taxonomy_tool.py 词表 validate / export / import / migrate
  build_icons.py   从 lucide 生成前端图标模块
  reset_data.py    清空题库数据（默认只预览，`--yes` 执行并自动备份）
  check_notes.py   批量校验知识点介绍（键集合 / 长度 / 重复 / 套话）
```

## 常用命令

```powershell
CodePowerPlus\Scripts\python.exe -m pytest -q
CodePowerPlus\Scripts\python.exe scripts\smoke_test.py
CodePowerPlus\Scripts\python.exe scripts\evaluate.py
CodePowerPlus\Scripts\python.exe scripts\taxonomy_tool.py validate
CodePowerPlus\Scripts\python.exe scripts\reset_data.py          # 预览将要删除的数量
CodePowerPlus\Scripts\python.exe scripts\reset_data.py --yes    # 清空题库（先自动备份）
```

## 主要接口

2026-10-17 已对当前41题运行v6全量重评，保留旧分析与2条审核，新结果统一待审核；逐题变化见 [本轮报告](data/evaluation/reassess-2026-10-17-v6/report.md)，已发现的模型内容问题见 [人工复核疑点](data/evaluation/reassess-2026-10-17-v6/review-notes.md)。重评不是准确率评测。再次运行须显式指定 `--analyze`；`--apply` 仅在全部完成并检查输入、版本与最新分析未变后追加，自动备份，不自动通过审核。

随后按负责人要求用v7重测尚未审核的35题，其他已审核题保留；当时过河卒按明确指示撤销误通过、改为1200分并驳回，之后负责人已重新审核通过。[35题历史报告](data/evaluation/reassess-2026-10-17-v7/report.md)及verification.json保留当时范围和核验结果。v7首测最终9/35驳回，其中算法9/24驳回，结果不理想。`--unreviewed-only --analyze --apply`只处理从未出现审核记录且当前待审或无分析的题；冻结后发生审核会拒绝整批写入。历史v6/v7批次需读取原归档，不要在旧输出目录运行新提示词。

v8首测单独使用 `scripts/v8_blind_evaluation.py`：先冻结9道旧驳回和11道新增题，再真实预测并封存于本机工作区外，不写正式题库。公开 `data/evaluation/v8-first-test/commitment.json` 保存哈希承诺；完整人工评分到达后才揭盲。[v8首测分析](docs/v8-first-test-analysis.md)已完成：全20题MAE170，新增11题181.8；旧9题同份本轮人评下v7 MAE322.2→v8 155.6，但存在严重解法/证明漏检，当前仍为实验版本，不支持免审生产。用户本轮只评难度，容差比例不等于正式驳回率。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/health` | 服务与知识体系版本 |
| GET | `/api/overview` | 工作台计数与个人薄弱点 |
| GET | `/api/knowledge/tree` | 知识树 |
| POST | `/api/problems` | 保存题目、可选参考题解／代码，分配编号 |
| GET | `/api/problems` | 标题优先搜索 q；difficulty_min / difficulty_max 难度筛选；knowledge_ids 逗号分隔多标签、同时包含且各含下级（兼容 knowledge_id）；limit / offset 分页 |
| PUT | `/api/problems/{id}` | 修改题目（携带 expected_revision），旧分析标记需要更新 |
| POST | `/api/problems/{id}/analyze` | 根据已保存输入生成待审核模型分析 |
| POST | `/api/problems/{id}/analyses` | 手工标注（新版本，待审核） |
| GET | `/api/problems/{id}/analyses` | 分析历史与对应输入快照 |
| GET | `/api/reviews?status=pending` | 待审核队列 |
| POST | `/api/problems/{id}/review` | 通过 / 驳回 / 带纠正通过 |
| POST | `/api/submissions` | 记录提交（标签取自已审核分析） |
| GET | `/api/users/{user_id}/profile` | 能力画像 |
| GET | `/api/users/{user_id}/recommendations` | 推荐题目 |
| GET | `/api/users/{user_id}/learning-path` | 学习路径 |
| POST | `/api/tutor/hint` | 分级辅导提示 |

题目修改后，原分析和审核记录仍然保留；旧分析不再用于新提交和推荐，需生成新分析并重新审核。
手工标注页面携带 `expected_revision` 防止把旧输入的标签保存到已修订题目；原有提交的知识快照不倒改。


## Docker

```powershell
docker build -t codepowerplus_prototype .
docker run --rm -p 8000:8000 --env-file .env codepowerplus_prototype
```

## 边界与限制

- 本地单用户原型：不执行用户代码，判题结果由人工登记；数据库是本地 SQLite 文件。
- 不依赖学校 OJ 源码、管理员权限或私有数据；将来通过导入或公开接口接入。
- 画像与推荐是可解释的启发式规则，不是校准过的学习概率；离线实验夹具为项目自编，
  只能验证流程，不能证明真实教学效果。
- 知识体系是项目自编的标签词表，结构参考 OI Wiki 栏目，未经教师或专家逐项审核。

## 设计系统

桌面端工作台的组件规范、视觉令牌、动效规则和交接说明位于 `docs/design/`。
该目录定义组件层；总览与知识树页面已实现，其余页面布局尚未设计。实现前先读 `docs/design/FINAL_FRONTEND_TEMPLATE.md`。
