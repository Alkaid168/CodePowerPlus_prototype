# 码力加加（CodePowerPlus）

面向算法竞赛训练的智能辅导原型：给题目打知识标签，按标签记录做题证据，生成能力画像，
再据此推荐题目与学习路径。开发与学校 OJ 解耦，不需要 OJ 源码，先用手工与公开数据跑通闭环。

## 四件事

1. **题目录入与分析**：题面用 Markdown（LaTeX 公式可排版），编号从 1000 起自动分配；
   保存后调用模型给出知识点标签、Codeforces 风格难度评分（800–3500）、证据句与置信度。
2. **人工审核**：分析先进入待审核，通过后才成为证据；纠正会生成新版本，旧版本与审计记录都保留。
3. **能力画像**：按独立题目的最后一次非 CE 结果估计每个知识点的掌握度。
4. **推荐与路径**：只用当前版本、已审核的题目，按标签薄弱度与难度适配排序。

## 快速开始

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
  knowledge_taxonomy.json        标签词表（345 节点；313 个叶子各带一段 50–200 字介绍）
  knowledge_taxonomy.schema.json JSON Schema
  taxonomy_versions/             版本快照
  evaluation/                    离线评估夹具与报告
scripts/
  seed_demo.py     写入演示题目
  smoke_test.py    端到端自检（不碰正式数据库）
  evaluate.py      离线实验：标签指标与推荐指标
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

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/health` | 服务与知识体系版本 |
| GET | `/api/overview` | 工作台计数与个人薄弱点 |
| GET | `/api/knowledge/tree` | 知识树 |
| POST | `/api/problems/analyze` | 模型分析并保存题目 |
| POST | `/api/problems/{id}/analyses` | 手工标注（新版本，待审核） |
| GET | `/api/reviews?status=pending` | 待审核队列 |
| POST | `/api/problems/{id}/review` | 通过 / 驳回 / 带纠正通过 |
| POST | `/api/submissions` | 记录提交（标签取自已审核分析） |
| GET | `/api/users/{user_id}/profile` | 能力画像 |
| GET | `/api/users/{user_id}/recommendations` | 推荐题目 |
| GET | `/api/users/{user_id}/learning-path` | 学习路径 |
| POST | `/api/tutor/hint` | 分级辅导提示 |

## Docker

```powershell
docker build -t codepowerplus .
docker run --rm -p 8000:8000 --env-file .env codepowerplus
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
