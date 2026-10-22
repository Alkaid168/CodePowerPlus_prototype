# 四平台数据采集机制研究

研究日期：2026-10-21（Asia/Shanghai）。状态：首轮机制研究与匿名可得性验证完成，应用采集器和数据库迁移尚未实施。

本轮按用户要求阅读项目，尤其是只读作者笔记`作者笔记（AI只读，勿修改）/10.21 数据采集与存储模块.md`，随后直接调查Codeforces、洛谷、AtCoder、VJudge，不发需求问题。本文区分现场验证、维护者资料、工程建议与待验证条件。原笔记不修改。

## 1. 已经获得什么证据

四站不能用一套“爬页面+翻页”处理。提交事件、源码、题面、标签和难度是不同的获取任务，权限、请求量和覆盖范围也不同。官方API优先，网页内部接口作适配器，第三方副本必须记录来源。

| 平台 | 提交事件入口和本轮结果 | 源码路径和本轮结果 | 结论边界 |
| --- | --- | --- | --- |
| Codeforces | 官方`user.status`匿名200/OK，验证两小页和单次1000条 | 当前官方文档有`includeSources`；匿名带此参数400，明确只能请求本人源码 | 可以优先落地元数据；本人签名API取源码待验，未做数万历史或私有Gym验收 |
| 洛谷 | `record/list`匿名401，JSON明确“请先登录” | 官方代码公开计划有条件，比赛代码有限制；本轮未登录 | 列表需要正常登录会话；无法承诺任意他人历史或代码可取 |
| AtCoder | 非官方AtCoder Problems API匿名200；四页去重1630，与副本同窗计数1630一致 | 三方返回结构不含源码；官网本机连接重置，网页读取服务的官网列表跳转登录 | 证明副本内对账成功；不等于官网完整、及时，也不等于本人真实账号验收 |
| VJudge | 网页内部`status/data`匿名200；验证两小页、20条一页与超大offset空页 | 本站前端使用POST `/solution/data/{runId}`；本轮正确POST仍400/crawler_blocked | 提交元数据可访问；源码在当前匿名环境被拦，不能承诺可取 |

本轮本机证据索引共50次HTTP尝试（包含资料、站点静态脚本和GitHub源码），46次收到HTTP响应、4次传输连接重置；不是50次批量提交列表采集。各站请求之间约3秒或更长，没有并发轰击同站，没有账号登录、提交评测、验证码处理或改外站数据。

证据保存在本机忽略目录`output/collection-research-2026-10-21/`：`evidence-index.json`包含URL、请求方法、UTC时间、HTTP状态、响应大小、SHA256；`*.body`是原响应；`*.meta.json`是对应收据。可公开的摘要见同目录之外的`docs/collection-platform-evidence-2026-10-21.json`。原始HTML/JS不执行、不作为本项目代码或公开数据集。

## 2. Codeforces：官方API可以减少请求数量

一手资料：[API总则](https://codeforces.com/apiHelp)、[方法表](https://codeforces.com/apiHelp/methods#user.status)、[对象表](https://codeforces.com/apiHelp/objects#Submission)。现场响应分别为`cf-api-help`、`cf-methods`、`cf-objects`。

### 2.1 分页与事件字段（已验证）

`GET https://codeforces.com/api/user.status?handle={handle}&from=1&count=1000`。

`from`从1开始，结果按提交ID降序。实测公开示例tourist：from=1/count=2和from=3/count=2返回不同记录；count=1000返回1000条；from=1000000/count=2返回OK和空数组。后者只验证空页语义，不证明中间历史完整。当前文档未在user.status条目写明count硬上限，不能把其他方法的10000 handles限制当作提交上限。本轮只证实1000可用。

记录包括提交ID、创建时间（Unix秒）、题目标识/名称/原始rating/tags、参赛者成员/参赛类型、语言、原始verdict、耗时和内存等。保留`participantType`，后续区分正式比赛、练习、虚拟比赛；队伍提交的`members`不可压成一位成员。题目可能缺contestId/rating，缺失保留未知，不按0分处理。

API响应包的FAILED表示请求失败；Submission.verdict的FAILED是记录中的一个平台状态，两者必须分开。HTTP200也必须检查status、result类型和字段。

### 2.2 频率与源码（文档+负例实测）

官方总则：API每两秒最多一次调用。建议同一站点共用串行限速器，初始间隔至少3秒；不是每个协程都各自两秒。出现Call limit exceeded、429或服务故障按Retry-After/退避处理，不能继续推进断点。

**当前文档的重要变化**：user.status的`includeSources`允许本人账号请求带源码；contest.status的同名参数要求asManager与该比赛管理权限。不能沿用“CF API永远没有源码”的旧结论。

本轮匿名请求tourist的includeSources=true：HTTP400，FAILED，comment明确只能包含本人提交的源码。因此后续本人源码首选研究官方签名API，而非每条提交都抓HTML。官方总则定义apiKey、time、apiSig/SHA-512；时钟偏差超过5分钟会拒绝。密钥/secret只从环境配置读取，不写进任务游标、响应归档URL或公共日志。本轮没有读取配置密钥或执行认证取源码；返回源码的具体字段名与尺寸需在本人权限样本中验收，当前对象表并未完整描述新增源码字段。

### 2.3 全量/增量建议（尚未实施）

- 元数据按1000条试起，源码批量另设更小页面以控制响应体；不要把一次成功推为固定最大页长。
- 起始冻结首批最高提交ID与任务时间，历史回填保留它们；offset可能随新提交/隐藏或删除变化，恢复时向前重叠若干页，并按平台+提交ID幂等写入。
- 后续增量从第1页重扫，遇到已知历史边界并覆盖重叠窗口后停止；不能持久保存一个数字offset后永远接着它跑。
- 重叠只能缓解列表漂移，不能数学保证任意删除/可见性变化下完整。需要二次核对与定期回扫，受限范围显式标记。
- 进行中提交与后续重判需更新同一外部ID的状态版本；只追新ID会漏重判。
- CF题目原始rating/tags优先使用已返回字段/按需缓存官方题库元信息；题面另取公开题页，HTML及公式转Markdown要单独验收。题目目录响应不是完整题面。

## 3. AtCoder：先取维护者副本，完整性要分两层

维护者一手资料：[API/Datasets](https://github.com/kenkoooo/AtCoderProblems/blob/main/doc/api.md)。它明确是非官方服务、单用户每次最多500条、调用间隔大于1秒。本轮经GitHub API取到维护者源码，冻结Git树`c22ce6177adf7ce7ffd1bccc541c63d87b514c86`；raw.githubusercontent连接重置后改用GitHub API，未改变系统代理。

核心实现：[单用户查询与计数](https://github.com/kenkoooo/AtCoderProblems/blob/c22ce6177adf7ce7ffd1bccc541c63d87b514c86/atcoder-problems-backend/server-db/src/submissions.rs)、[请求处理](https://github.com/kenkoooo/AtCoderProblems/blob/c22ce6177adf7ce7ffd1bccc541c63d87b514c86/atcoder-problems-backend/src/server/handlers/submissions.rs)。本地解码副本`ac-source-0.txt`/`ac-source-1.txt`。

### 3.1 接口语义（源码+实测）

- `GET https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user={id}&from_second={s}`。
- 下界包含：源码是epoch_second>=s，按时间升序，仅时间排序，没有保证同秒ID顺序。用户查找忽略大小写，但保留返回的原始user_id。
- 单用户上限500。请求结构虽然有to_second，单用户取列表handler没有用该字段；截止时间必须客户端过滤，不能以为传to_second就实现服务器窗口。
- `GET .../v3/user/submission_count?user={id}&from_second={s}&to_second={e}`计数窗口为`[s,e)`，用于同副本对账，不是AtCoder官网证明。
- 提交记录有id/epoch_second/problem_id/contest_id/user_id/language/point/length/result/execution_time，没有源码。point是题目得分相关字段，不能冒充题目difficulty。

### 3.2 已完成的副本对账示例

公开示例账号tourist，范围`[0,1792537200)`，截止时刻为2026-10-21 07:00北京时间。四批页长500、500、500、133；共1633行，3个边界重复，按提交ID去重1630条，副本计数1630；末秒计数1，末秒+1请求为空。已核对时间升序、ID不冲突，证据`atcoder-coverage-check.json`。

这是一个真实网络拉取示例，没有用合成提交冒充抓取。但它只覆盖该副本当前收录集合：最早2016-09-04 12:09:02 UTC，最新2026-07-09 04:50:01 UTC。最新停留7月可能来自选手行为或副本缺失/延迟，本轮无法归因，更不能宣传截至10月的官网全部历史已采完。暂无本人绑定账号验收、源码、断线恢复或实际增量测试。

### 3.3 秒游标必须防止漏数据

下一页从上一页末秒重叠取，按ID去重。若末秒记录被500条截断，重复查询可补齐该秒的一部分；应以该秒计数对比已保存ID数。只有确认该秒收齐后才能推进到下一秒。若同一秒达到/超过500且接口无法前进，记为明确缺口并换允许的补采来源，不能无条件末秒+1。

短页也不能替代副本同步完整性证明；全量后定期回扫重叠时间窗口，应对副本晚到和重判。若晚到提交早于窗口，需要周期核对历史分段计数和可配置深回扫。副本计数一致不代表正确性已经独立验证。

维护者还提供contests/problems/merged-problems/contest-problem与problem-models资源、文档标注每周更新的历史CSV。只调查入口，本轮未下载全站CSV。problem-models难度是社区估计，需存来源/版本/is_experimental等可得字段；不能直接当CF刻度或项目已审核难度。算法标签缺失应为未知，后续单独映射/分析。

### 3.4 官网补采边界

本机访问用户页、示例源码页均连接重置，无HTTP状态；只能记传输错误，不能认定Cloudflare或封IP。独立网页读取服务访问官方`/contests/agc004/submissions?f.User=tourist`跳到登录页（2026-10-21），说明该访问条件下列表需登录。源码页未取得，正常登录后逐比赛列表和源码的分页/权限仍待验。此次没有修改代理、尝试隐蔽绕过或假设登录后必然全部可得。

## 4. 洛谷：匿名题面可得，提交列表需登录

一手资料：[个人设置](https://help.luogu.com.cn/manual/luogu/account/setting)、[公开题目P1001](https://www.luogu.com.cn/problem/P1001)、[标签词典](https://www.luogu.com.cn/_lfe/tags)、[开放平台](https://docs.lgapi.cn/open/)。

### 4.1 实测

`GET https://www.luogu.com.cn/record/list?user=1&page=1`返回HTTP401，errorType为UserUnloginException、needLogin=1。没有登录凭据，本轮不继续试隐藏参数或反复请求。该请求体现当前匿名权限，不能推断所有用户的记录都公开，也不能视为空历史。

公开P1001为HTTP200；HTML的`<script id="lentille-context" type="application/json">`内含结构化上下文，可用JSON解析器读取，不执行网页JS：`data.problem`包含pid/type/name/difficulty/tags/contenu等。P1001本轮difficulty=1，tags=[1]；标签词典返回id=1“模拟”，词典版本`zh-CN/2026102111`。这些是洛谷原生元信息，不是本项目打标标准。保留contenu原字段（如name/background/description/formatI/formatO/hint等实际字段）和样例，渲染转换另验。

个人页匿名200但部分统计如passedProblemCount为null；个人页题数、日历和AC集合都不能代替每次WA/TLE/CE的事件历史。本轮未将个人介绍等内容写入公开摘要。

### 4.2 登录、源码和分页待验

官方代码公开计划要求查看者达到对应题目的条件并加入计划，对方也需加入；比赛代码不可据此查看。完全隐私保护、私有比赛/团队另有可见性。正常本人会话或平台允许的导出应优先，不能保证公开账号名足以取得源码。

当前页面loader包含record.list/record.show路由；本轮未取得登录态列表结构，**page_size、总量字段、按时间还是ID排序、历史截断、源码可见性均未验证**。URL中的page只说明入口参数，不是翻页成功证据。后续读取本人登录态第一页/下一页/末页与详情，再固定解析契约与ID；会话失效需暂停任务，不能把401解析成0条。

### 4.3 开放平台不能误当个人历史接口

现场读取[端点](https://docs.lgapi.cn/open/api/endpoint)与[OpenAPI](https://docs.lgapi.cn/open/openapi)：服务主要提供题库和提交评测/结果。`/judge/result`用本服务提交返回的Request ID取结果，文档写缓存1小时；本轮所查文档未发现任意主站用户历史导出接口。不能靠“有官方API”就承诺解决历史采集。猜测`/open/api/`路径404已记录，随后按首页真实链接找到文档；不把404解释成API不可用。

## 5. VJudge：事件可取，源码被拦，汇总数不可信

一手资料：[本站提交页](https://vjudge.net/status)、[本站帮助](https://vjudge.net/article/2771)、由提交页实际引用的当前前端脚本。核心业务脚本`/static/bundle/8656acb6bcf92f34ece7.js`、源码查看脚本`/static/bundle/87ea8690d273e8ae3c8c.js`。路径带内容哈希，不能永久写死到采集器。

### 5.1 当前内部接口

`GET https://vjudge.net/status/data?draw=1&start=0&length=20&un={username}`。当前前端DataTables serverSide/pageLength=20，使用start/length；界面过滤项包含un/OJId/probNum/res/language/onlyFollowee。

本轮公开示例kuangbin：start=0/length=2与start=2/length=2返回不同记录；length=20返回20条；极大offset返回空data。字段包括runId（外部提交ID）、userId/userName、time（Unix毫秒）、oj/probNum（原OJ/题号）、problemId（VJudge内部题ID）、contestId/contestNum、status/statusType/processing、access、language、runtime、memory、sourceLength等。CF/AtCoder是秒，VJudge是毫秒，统一UTC之前必须显式换算。

**recordsTotal和recordsFiltered各次均为9999999，空页也一样，不能拿来算已完成百分比或证明真实总量。** draw是表格请求序号，不是历史游标。未从当前页面证实maxId/minId筛选，不能自行假设参数有效；未知参数可能被服务静默忽略。

元数据按runId幂等，原OJ+原题号用于建立有依据的题目映射；VJudge内部problemId不能当原OJ题号。不能把VJudge的一次runId和原OJ某条记录因为时间接近就自动当同一提交，用户在两站分别交同题本来也是两次事件。

### 5.2 源码/重判/比赛权限

前端正常源码查看为只读用途的POST `/solution/data/{runId}`（可携shareCode）。本轮先GET遇400/crawler_blocked，核对前端后按正常POST复核，结果仍同错误；未重试验证码或继续扩大请求。记录应为`source_state=blocked`，不能存空字符串后表示“已获取源码”。access数字枚举含义尚未完全核实，不能因为access=0就承诺源码公开。

当前前端用POST `/status/dataById`刷新进行中记录；本轮仅观察脚本没有发起该接口。后续可验证它是否适合少量待判记录刷新；不是执行rejudge，不得调用`/problem/rejudge`。已结束的历史结果也可能重判，需要回扫策略。本站帮助说明比赛期间完成的题可能待比赛结束才显示在个人题目列表，因此AC汇总列表不是完整提交历史。

接口属于本站网页内部契约，本轮未找到稳定的公开开发者API或明确官方限频承诺。建议从每3–5秒、20条、同站串行开始；这只是保守工程起点，不能宣传是平台批准配额。

## 6. 统一采集可靠性建议（待设计/实现）

### 6.1 任务状态和断点

通用能力应包含适配器版本、源站/第三方来源、账号与权限范围、时间窗口、页/秒游标、已见ID、最高/最低边界、有效响应计数、退避到期时间。停止状态至少区分完成当前可见范围、部分完成、等待登录、被拦、限流、临时网络错误、格式变化、取消。缺字段/挑战HTML/登录重定向均不能作为空页终止。

每页流程：发请求→检查HTTP+内容类型+业务状态+结构→保存必要原始证据→短SQLite事务写提交/变更与游标→提交事务。写失败回滚，重启重复抓该页；写成功但断点未提交也允许重放，唯一键去重。网络等待在写事务外。原始大响应放文件时先写临时文件、落盘后原子改名，再在事务登记哈希；允许回收孤立文件，不允许任务引用不存在的证据。

200正常JSON不等于完整；CF显式FAILED、洛谷401、VJudgeerror、HTML挑战与传输重置分开记录。网络错误有限次数指数退避并加随机抖动，429按Retry-After。需要登录/验证码时暂停该权限路径，保留已完成记录；不丢掉其他平台已可用的成果。

### 6.2 SQLite存储候选职责

这是由研究推出的建议，**不是已经建表或已批准的最终表结构**。当前`app/db.py`schema v3已用WAL与短事务；手工submissions的created_at由本地utcnow产生、problem_id强依赖内部题库，不能直接承载外站尚未映射题和真实历史时间。

| 记录职责 | 建议保存 | 为什么需要 |
| --- | --- | --- |
| 外部账号/关联 | platform、稳定UID（可得时）、handle原值及变更、local_user_id、绑定依据 | 同名跨站不是同一人，公开样例不是用户已绑定账号 |
| 外部题目 | platform+external_problem_key、URL、原OJ/题号、原生难度及量表、标签原值与版本 | 暂无内部problem_id也能先存提交，跨站题目合并有据可查 |
| 外部提交 | UNIQUE(platform,external_submission_id)、source_provider、账号/成员、题键、submitted_at_utc、原始verdict/归一化状态/得分、first_seen/last_seen | 去重、保留历史时间、分离平台与第三方副本，支持队伍成员 |
| 状态观测/版本 | external_id、观测时间、原始payload哈希、状态与变更 | 重判更新当前视图且保留旧观测，不能把重判当第二次作答 |
| 源码对象/获取状态 | code或压缩对象引用、哈希、语言、source_state和失败原因 | unavailable/private/blocked/not_requested与空代码不同 |
| 采集任务/检查点 | 冻结窗口、权限、游标、页收据、覆盖摘要、错误/重试 | 可恢复、可解释部分覆盖；游标版本和适配器对应 |
| 题目映射/分析引用 | 内部题号可空、跨站映射依据/置信度/审核、分析版本 | 不按同标题自动合并，不把外站tags直接变成画像标签 |

外站已过题即使暂无题面/代码/标签也应入原始采集区；是否进入画像属于后续规则。保留原始WA/TLE/CE/RE和部分得分，尚未判完及系统提交失败不直接算学生能力失败。AC只表明该提交通过，不能证明掌握该题所有可能解法。

源码和原响应可能远大于行数；数万条SQLite事件可先验证索引、按账号+提交时间分页和批量短事务，无需为规模口号引入Neo4j/Redis。容量测试用合成数据并明确标记，不能冒充几万条真实采集。导入/迁移测试使用临时库，不碰正式学习记录。

### 6.3 完整性报告

按“平台、来源、账号、权限、起止窗口、适配器版本”出覆盖收据，列原始行数、唯一ID数、重叠重复、状态更新、无源码比例、题面/元信息覆盖、成功末页、独立总量核对方法、无法访问区间和已知截断。

CF/VJudge当前样例没有可信总数，最多报告遍历当前可见分页并说明限制；不能用ID差推数量，平台ID会跨用户跳跃。AtCoder副本有窗口count，也只是副本内部核对。按平台与来源分别表示`complete_visible`、`complete_replica`、`partial`、`not_verified`等，不用一个“100%”遮盖所有维度。

## 7. 分站落地顺序与验收缺口

建议先共用数据契约/任务持久化，再CF元数据闭环，AtCoder副本适配，VJudge元数据，洛谷本人正常登录态；源码作为独立补采阶段跟随各站权限，不因源码卡住而丢掉提交历史。此顺序是基于本轮可得性的建议，不取消用户四站目标，也不覆盖其他对话评分工作。

每站验收：同一真实授权账号全量与计数核对（可得时）、中断重启后集合不变、同批重放无重复、再次增量能取新记录、旧记录重判能更新、401/403/429/挑战/网络错误不会误报完成、缺字段/毫秒时间/同秒/动态offset/题目未映射有隔离测试。尚未实施这些验收，AtCoder例仅证明一次副本分页对账。

| 问题 | 已做检查 | 当前影响 | 后续可做/需要老师协助的方向 |
| --- | --- | --- | --- |
| 洛谷登录后历史/源码范围未知 | 匿名401、官方设置与开放平台资料 | 暂不能承诺全历史与代码 | 本人正常登录样例；如平台限制历史导出，可请老师协助正规数据导出或联系渠道 |
| VJudge源码被拦 | 同一示例正常POST仍crawler_blocked | 元数据可采，源码不可验 | 正常浏览器本人会话或允许的代码导出；如仍拦，记录错误请求平台支持 |
| AtCoder官网本机连接重置 | 用户页/源码页失败，外部读取器列表转登录 | 无法独立验证副本覆盖/官网源码 | 后续正常网络与登录态小样例对照，允许本人导出；不据当前错误改系统网络 |
| CF本人源码认证未验 | 当前文档+匿名负例 | 元数据可先实施，源码字段未知 | 有本人API权限后小样例验证，不在公共文件/对话索要secret |
| 副本晚到、同秒截断、历史重判 | 维护者源码/秒计数与重复边界实测 | 单次成功不保证长期完整 | 对账/回扫/显式缺口；独立源可得时再核对 |

本轮只研究与记录，没有数据库迁移、应用代码改动、正式学习数据写入、模型调用或Git提交推送；已有动态评分改动保留。原始研究下载物留本机output，公开摘要去除个人介绍、联系方式及无关用户资料。

## 8. 最终核验与并行改动

46份响应SHA256全部核对，CF1000条与小页一致、VJudge20条与小页一致、AtCoder同ID载荷一致/时间升序/去重计数一致均通过。原始作者笔记及拆分笔记哈希不变。核验曾发现app/services/rating.py与requirements.txt在研究期间变化；本任务未编辑两处，视为并行修改保留、未回退，不声称全工作区哈希相同。当前其他对话还更新共享记录中的项目主线，本任务只追加自己结果并保留其段落；其中角色指代不改变本对话的数据采集与存储职责。应用未因本任务变更，故未重跑应用测试；本地核验收据verification.json明确此范围。
