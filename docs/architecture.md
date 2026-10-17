# 码力加加系统架构（0.4）

本文主体记录 2026-09-13 的整体重写：后端按 `db → repositories → services → api` 分层，
前端改成无构建步骤的 ES 模块。上一版的问题很具体：接口全挤在 `main.py`，仓储类同时写 SQL
与业务规则，前端是一个 32KB 的单文件压缩脚本，没有统一错误处理，也没有响应契约。

2026-09-21 重做了「题目录入与分析」模块（架构分层不变）：题面改成 Markdown，
难度改成 Codeforces 风格评分，题目编号从 1000 起自动分配，来源改成链接，
录入后调用模型分析并在页面上渲染 LaTeX 公式。下面标注了本次改动的部分。

2026-10-16 扩展为项目评分 100–3500：100–700 面向 C 语言新生，800 起保留原算法评分分档。词表 `2026.10.1` 共 377 节点、10 个一级领域，新增语法基础 `syntax`；`basic` 仅更名为算法基础，原算法节点 ID 保留。

## 一、分层与职责

| 层 | 文件 | 只负责 | 不负责 |
| --- | --- | --- | --- |
| 存储 | `app/db.py` | 连接、表结构、事务、旧库补列 | 任何业务判断 |
| 数据访问 | `app/repositories.py` | 读写行、行转字典 | 标签是否合法、能否审核 |
| 业务 | `app/services/*` | 分析校验、审核流程、画像公式、推荐、辅导 | HTTP 细节、SQL |
| 接口 | `app/api/*` | 参数解析、依赖注入、响应组装 | 业务规则 |
| 组装 | `app/main.py` | 建应用、挂路由与静态文件、错误处理 | 具体功能实现 |

接口层通过 `app/container.py` 里的 `Container` 取依赖（配置、数据库、知识树、四个仓储）。
测试因此可以给每个用例装配「临时数据库 + 关闭模型」的独立实例，不用改任何全局变量。

## 二、数据模型

```sql
problems(id, title, description, source_url, reference_solution, reference_code, revision, created_at)
problem_analyses(id, problem_id, payload, origin, initial_status, taxonomy_version, problem_revision, input_snapshot, created_at)
analysis_reviews(id, problem_id, original_analysis_id, analysis_id, action, reviewer, comment, created_at)
submissions(id, user_id, problem_id, verdict, code, language, knowledge_ids,
            taxonomy_version, analysis_id, difficulty, created_at)
schema_meta(key, value)
```

2026-10-04 存储版本升级至 3：参考题解和代码独立保存，可为空。题目信息变化时 `revision` 加一，
分析保存对应的 `problem_revision` 和完整输入快照。`is_stale` 根据当前题目版本推导，不改写旧审核状态。
过期分析不能审核、不参与推荐或新提交的知识证据；已有提交保留原快照。旧分析没有历史输入快照时返回空对象，
界面明确说明无法核验历史输入，不用当前题面冒充旧输入。题目修改使用版本乐观锁；
分析保存、审核纠正与审计、提交证据读取与写入均在事务中完成。

两条贯穿全系统的约定：

1. **分析版本不可变**：每次保存都是新插一行，`MAX(id)` 是当前版本；历史永远可查。
2. **审核状态由最新一条审核记录推导**：`approve → approved`、`reject → rejected`，
   没有审核记录时看 `initial_status`（`pending` 或旧数据迁移出来的 `legacy`）。

题目相关的三条约定：

1. **`id` 就是对外 OJ 编号**，从 1000 开始。编号在插入语句里用 `MAX(id) + 1` 计算，
   不依赖 `AUTOINCREMENT`——0.2 版原型建的库是普通 `INTEGER PRIMARY KEY`，
   根本没有 `sqlite_sequence` 表（这一点踩过一次，见 `findings.md`）。
2. **题面是 Markdown**，服务端只去掉整段首尾空白，不做任何转换；渲染与公式排版在前端完成。
3. **难度是项目整数评分 100–3500**，必须是 100 的整数倍。100–700 依次覆盖固定输出、变量与输入输出、基本运算、条件分支、循环与数组、字符与字符串、基础综合；800 起保持原算法分档。
   中文档位不落库，由 `services/difficulty.py` 按评分实时推导。语法 L2/L3 的 `intro_rating` 表示最低适用阶段，普通算法标签最低 800；标签门槛不等于题目最终评分，出现数组也不代表固定评为 500。

`source_url` 可以为空，非空时必须是 `http(s)://` 链接；旧库的 `source` 自由文本列
在启动时自动改名为 `source_url` 并保留原值。

`payload` 里存完整的分析 JSON（标签、难度、证据、置信度、模型名、提示词版本）。
`knowledge_ids` 是提交发生时从「当前已审核分析」复制下来的快照——这样以后重标注题目，
不会倒改已经发生的学习记录。

`origin` 用来区分 `model` / `manual` / `legacy`：旧原型的数据升级后自动标记为 `legacy`，
既不丢数据，也不会突然被当成已审核证据。

## 三、关键流程

### 1. 题目分析

```text
题面 ──模型──┐
             ├─→ 标签校验（L2/L3、祖先后代互斥、证据、置信度）
人工标注 ────┘        │
                      └─→ 新分析版本（pending）→ 等待审核
```

录入与分析是**两步接口**：`POST /api/problems` 先落库并分配编号，
`POST /api/problems/{id}/analyze` 再调用模型。这样模型不可用时题目仍然存在，
用户可以重试分析或改手工标注，不会出现「模型失败、题面一起丢」。

模型输出与人工标注走**同一个**校验函数（`services/analysis.py` 的 `validate`），
区别只写在 `model_name` 与 `origin` 上。这样模型不可能绕过规则，人工纠错也不必走第二套代码。

当前模型提示词版本为 `problem-analysis-v8`，人工分析来源版本为 `manual-v2`。`analysis_v8.py`真实分两次调用：先形成解法、可行方法和标签映射，机器校验方法知识点并集与最终标签相等；再以知识、建模、证明、实现四维审查后整体评分，发现实质问题最多退回解法一次。结构修复保留模型自己的被拒响应和具体错误，不机械加分或改标签规避校验。`assessment_meta`保留阶段、响应model、用量、耗时和可见结构化输出；人工标注会清除旧模型审计元数据。自报置信度未校准。

700及以下只能包含syntax标签并满足门槛，800及以上在核心／辅助中均禁止syntax标签；通过validate统一强制执行，不能依赖模型自觉遵守。历史分析、审核、提交及冻结 public40 结果保留原版本。词表快照按版本存放，700的小规模质数试除与原高级数论标签分离，详见 [C 语言新生语法词表说明](c-syntax-taxonomy-2026-10-16.md)。v7为非成品，v8的20题实验不进入正式库，预测先封存，人工只评难度后再揭盲，参见[v8首测协议](v8-first-test-protocol.md)。

显式批量重评由 `app/reassessment.py` 和 `scripts/reassess_problems.py` 承担。首次冻结全部五项题目信息、revision及最新分析ID；断点指纹包含完整词表与系统提示词哈希、模型和端点。模型调用最多两路并发，检查点由主线程串行写入。全部通过后先在线备份，再在单个事务中核对题目集合、五字段及最新分析，追加pending记录，并在schema_meta保存批次收据以防重复追加。失败不部分入库，也不更改旧分析、审核或提交。默认离线evaluate命令固定使用其authored_fixture对应的2026.09.9快照，保持历史实验可复现。

`--unreviewed-only`冻结从未有审核记录且当前待审或无分析的题目。事务写入前重新核验该范围；模型运行期间新增审核、分析或题目会导致冲突，不能覆盖人工决定。已成功批次的事务收据先校验原结果，幂等重跑不会撤销后来的人审。

### 2. 人工审核

负责人明确要求撤销误通过时，可由内部维护函数withdraw_approval按指定当前approved分析ID处理，不开放为普通审核接口。先校验可选纠正内容，再在事务内对原版本追加reject审计；有纠正则追加manual分析及其reject审计，保留原通过记录。#1005本次按指示修正1200并去掉语法标签，原版本与修正版本均驳回。该操作须先在线备份，不是批量模型评估产生的人工金标准。

审核请求必须带上它看到的 `analysis_id`。服务端在 `BEGIN IMMEDIATE` 事务里重新读一次：

- 对不上或状态不是 `pending` → `409 conflict`，避免两个人互相覆盖；
- 通过时可以带纠正内容，但纠正会**新建一条分析版本**，审计里记录 `original → new`；
- 驳回只写审计，不改动原分析。

### 3. 提交 → 画像 → 推荐

```text
提交（判题结果）
  └─ 取该题当前「已审核 + 版本一致」的分析标签 → 快照写入 submissions
       └─ 画像：同一题只取最后一次非 CE 结果，(1 + AC 题数) / (2 + 有证据题数)
            └─ 推荐：0.6 × 标签薄弱度 + 0.4 × 难度适配，排除已 AC，只推已审核题目
```

父节点（L1/L2）的分数是子树证据的汇总，另外单独输出 `direct_skill_mastery`，
避免把「学过子知识点」误当成「整个分支都掌握」。

## 四、接口约定

- 成功：`200` 查询 / `201` 新建资源。
- 失败统一返回 `{"code": "...", "detail": "..."}`：
  `404 not_found`、`409 conflict`、`422 invalid_input`、`503 model_unavailable`。
- 请求体禁止多余字段：提交接口根本没有「自由标签」这个入参，客户端无法伪造知识证据。
- 题目列表支持 `q`（标题优先，正文／当前标签其次）、`difficulty_min` / `difficulty_max` 与逗号分隔的 `knowledge_ids`。每个已选标签独立包含下级，不同标签组必须同时满足；保留旧 `knowledge_id` 兼容，若同时提供也参与交集。筛选和计数在 `limit` / `offset` 分页前执行，并返回 `total`；历史分析不参与当前筛选。

## 五、前端结构

```text
static/index.html      外壳：侧栏 + 顶栏 + 挂载点
static/css/            base（变量）/ layout（骨架）/ components（组件）/ overview（总览）
static/js/dom.js        极小 DOM 构造器，替代字符串拼 HTML
static/js/api.js        统一 fetch + 错误解析
static/js/store.js      学习者、服务状态、知识树缓存
static/js/router.js     哈希路由（#/problems/12）
static/js/search.js     知识点检索（中文名 + 英文 ID，分隔符归一化）
static/js/markdown.js   Markdown 渲染 + MathJax 公式排版（按需加载）
static/js/components.js 按钮、卡片、标签、表格、空状态、提示条
static/js/tagEditor.js  分析 / 纠正共用的标签编辑器
static/vendor/          marked 12.0.2 与 MathJax 3.2.2（随仓库分发，离线可用）
static/js/views/*.js    每个页面一个模块
```

渲染全部通过 `h()` 创建节点，不拼 `innerHTML`，因此不存在 HTML 注入问题；
图标由 `scripts/build_icons.py` 从 lucide 生成形状数据，不依赖 npm。

唯一的例外是 Markdown：HTML 必须由解析器产出，所以 `markdown.js` 用
`createContextualFragment` 挂载，同时在解析前把题面里的原生 HTML 全部转义、
链接只放行 `http(s)`，把 `h()` 的安全边界搬到了 Markdown 上。
第三方库用 `scripts/vendor_frontend.py` 下载并按 sha256 校验，不引入构建步骤与 CDN 依赖。

## 六、技术选型与取舍

- **FastAPI + Pydantic**：请求校验、OpenAPI 文档、异常处理都是现成的，适合作为唯一入口。
- **SQLite（单连接 + 事务 + WAL）**：单用户本地原型不需要独立数据库服务；
  备份就是复制一个文件，演示时也不怕网络。
- **原生 ES 模块而不是 React/Vite**：项目要能「一条命令跑起来」，多一个 npm 构建链就多一份
  学生无法维护的复杂度。模块化、组件化、状态管理都由上面的小模块提供，代价是少了 JSX 与生态。
- **Docker**：把 Python 依赖与启动方式封在镜像里，数据目录用卷挂出来。
- **Nginx**：只在本机使用时不需要；将来要公网 HTTPS 或反向代理再加。

## 七、怎么验证

| 手段 | 覆盖内容 |
| --- | --- |
| `pytest` | 词表规则、数据库与旧库兼容、仓储、分析校验、审核流程、提交、画像、推荐、各接口 |
| `scripts/smoke_test.py` | 在临时库里跑完整流程：建题 → 标注 → 审核 → 提交 → 画像 → 路径 → 辅导 |
| `scripts/evaluate.py` | 离线夹具上的标签指标与推荐指标，固定随机种子可复现 |
| `scripts/check_frontend.py` | 前端每个 JS 模块按真正的 ES 模块语法解析（`node --check` 会漏报） |

## 八、已知限制与下一步

- 判题结果仍然靠人工登记；接入 OJ 需要写导入器或适配层（`submissions` 表已留好扩展位）。
- 画像与推荐是启发式规则，需要真实标注与用户实验校准；离线夹具只能验证流程。
- 标签粒度目前对齐 OI Wiki 的一页一主题（例如「最短路」而不是「Dijkstra」），
  需要更细时按题目需求补 L3。
- 前端还没有自动化浏览器测试；目前的保障是接口测试 + 模块语法检查 + 自检脚本。
- 难度评分的档位锚点由项目负责人给定，尚未用真实人工标注做回归校准；
  模型对模板题可能给出偏低评分（实测同一道题在 800 与 1200 之间摆动）。

