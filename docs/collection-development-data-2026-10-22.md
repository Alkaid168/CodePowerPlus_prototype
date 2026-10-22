# 本人真实采集数据开发库

## 当前状态（追加AtCoder后）

2026-10-22补入AtCoder 6批/142条/142源码，原三站数据不变；当前四站共2013条提交、1987条含源码、1724份去重源码，库4517888字节（约4.31MiB）。AtCoder范围为replica_submissions/partial，不能推断官网全量。逐条字段/源码核对、幂等重放、完整性与外键均通过；导入前备份及收据在Git忽略的output/collector-private下。阶段验收见`docs/collection-stage-acceptance-2026-10-22.md`。

以下三站统计为首次导入时的历史记录。

- 用户明确授权导入其三份导出JSON，供本项目本机开发使用；数据类型为**真实本人采集记录**，不是合成样例、教师审核标注或自动认可的画像证据。
- SQLite：`data/collection-development.db`，本地用户键`alkaid16`，使用现有CollectionStore schema v2；独立于正式学习库及默认采集库。源码、数据库与含原文件路径/摘要的导入收据均受Git忽略，不进入公共仓库。

| 平台 | 提交 | 含源码提交 | 其他源码状态 |
| --- | ---: | ---: | --- |
| Codeforces | 294 | 292 | unavailable 2 |
| 洛谷 | 1119 | 1119 | 无 |
| VJudge | 458 | 434 | private 24 |
| 合计 | 1871 | 1845 | 26 |

- 76个批次全部先通过ImportBatch协议、字段、时区及源码SHA256校验，再导入。1871条新增、0更新；逐条核对元数据及源码正文与输入一致。
- 代码按用户内SHA256去重后1588份；库文件4182016字节（约3.99MiB），逻辑用量3767983字节。保留导出文件自报的coverage，不推断外站全量已独立验收。
- 第二次重放76批全部幂等、记录数及用量不变；integrity_check=ok、foreign_key_check无异常。没有调用模型或更新学习库。
- 私有收据：`output/collector-private/alkaid16-import-2026-10-22.json`，包含原路径、原文件SHA256、导入时间与核对结果；原JSON未修改。
- 后续本地应用联调可在独立进程设`CODEPOWERPLUS_COLLECTION_DB`指向该库，使用本地用户键查询；自动化测试仍用临时库，不能写入或清理这份真实开发数据。
