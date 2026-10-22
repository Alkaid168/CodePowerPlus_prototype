| 平台 | 统计 | 逐题 | 全部提交 | 源码 | 真正的限制 |
| --- | --- | --- | --- | --- | --- |
| Codeforces | **能**：`user.info/user.rating`及提交聚合。 | **能**：`user.status`含题号、结果、时间及可选得分。 | **能**：分页获取本人提交的时间、语言、verdict、耗时、内存。 | **能**：本人提交页；官方`user.status(includeSources=true)`支持本人源码。 | 私有Gym/群组按账号比赛权限开放；比赛进行中他人代码受限；`contest.status`批量带源码另需比赛管理权限。 |
| 洛谷 | **能**：本人个人页及比赛成绩。 | **能**：本人记录列表按题筛选，含结果、得分、时间。 | **能**：分页读取本人`/record/list`，由`/record/ID`补齐详情。 | **能**：读取本人记录详情中的代码，不要求加入他人代码公开计划。 | 查看他人代码须双方加入公开计划、查看者本题≥60分，比赛代码不适用该共享路径；题目测试数据另受下载权限控制。 |
| AtCoder | **能**：用户页、比赛成绩与`history/json`。 | **能**：官网提交按用户/题目筛选，含结果、得分、时间。 | **能**：逐比赛、逐页取本人提交，详情补齐耗时/内存。 | **能**：逐条读取官网提交详情的`#submission-code`。 | 官网需逐比赛翻页；第三方AtCoder Problems副本可能滞后，且不提供源码/内存；未产生的运行指标（如CE）没有数值。 |
| VJudge | **能**：个人页及本人提交聚合。 | **能**：`/status/data`含原OJ/题号、结果、时间。 | **能**：分页取本人记录，含语言、verdict、耗时、内存。 | **能**：本人会话POST `/solution/data/ID`读取自身代码。 | 他人源码受公开设置控制，文本分享可用`shareCode`；列表总数9999999为占位值；原OJ测试数据与逐点评测信息不由VJudge账号权限自动提供。 |

- 结论针对本人账号仍保存在平台、且该账号有权访问的记录；“能”表示可获取的数据层级，不表示本项目已经完成全量采集。
- CF：[官方方法与源码参数](https://codeforces.com/apiHelp/methods#user.status)、[认证说明](https://codeforces.com/apiHelp)；签名API需本人API凭据，网页路径使用本人会话。
- 洛谷：[他人代码公开规则](https://help.luogu.com.cn/manual/luogu/account/setting)；本人记录与他人共享权限分开判断。
- AtCoder：[官网详情解析实现](https://online-judge-tools.readthedocs.io/en/develop/_modules/onlinejudge/service/atcoder.html#AtCoderSubmission.download_data)、[副本接口说明](https://github.com/kenkoooo/AtCoderProblems/blob/main/doc/api.md)。
- VJudge：[官方文本分享说明](https://vjudge.net/article/18)；本人代码、他人公开展示、带分享码文本是不同访问路径。
- 更深内容：四站有题面及样例；评测详情以平台实际返回为准，题面样例/逐点结果不等于完整测试输入输出；接口证据见[已有报告](collection-platform-research-2026-10-21.md)。
