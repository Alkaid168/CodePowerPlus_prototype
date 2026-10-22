# 采集与存储0.4.0实施记录

## 已实现

扩展使用用户浏览器内IndexedDB v3，保存任务、提交、分页断点和上传计划。服务端使用独立`data/collection.db`，SQLite schema v2；与学习库隔离，未配置服务secret时上传仍关闭。两端均不存OJ密码或cookie值；本站上传令牌不持久化。

| SQLite表 | 关键约束 | 保存内容 |
|---|---|---|
| `external_submissions` | 用户/平台/账号/提交ID复合主键 | 题目、时间、语言、结果、分数、耗时、内存、源码状态/hash、首次/最近发现时间、计量 |
| `source_blobs` | `(user_id, hash)`唯一 | UTF-8源码BLOB，同一用户相同内容只存一份 |
| `observations` | 提交复合外键 | 无源码的元数据变化，每提交最多20条实际变化 |
| `batches` | `(user_id, batch_id)`唯一 | 内容摘要、范围及计数收据，不存原始批次正文 |
| `user_storage` | `user_id`主键 | 四站合计逻辑已用字节，与导入/删除同事务修改 |

尚未单建账号绑定或采集run表，平台/账号随提交与批次保存；这些字段不能当作独立账号归属认证。

## 配额、恢复与删除

- 每用户四站合计默认**120 MiB提醒、150 MiB硬上限**，可由`CODEPOWERPLUS_COLLECTION_WARNING_BYTES`和`CODEPOWERPLUS_COLLECTION_LIMIT_BYTES`配置。
- 逻辑计量：提交元数据UTF-8 JSON字节+256/条；唯一源码UTF-8字节+128/份；观察JSON字节+128/条；批次收据/摘要JSON字节+128/批。不等于SQLite物理大小，不计离线备份。
- WAL、外键、15秒busy timeout；`BEGIN IMMEDIATE`内计量并检查配额，超限HTTP413且整批回滚，并发也不能突破配额。重复同一批次ID/内容不重复计费；相同ID不同内容拒绝。
- 缺失源码不会覆盖已保存源码；替换/删除后无当前引用的源码回收。历史观察只有hash，不保证恢复旧源码。删除释放逻辑配额，数据库文件可复用空闲页，不保证立即缩小。
- GET `/api/collection/storage`查本人用量。DELETE `/api/collection/submissions?confirm=delete-account-data`需专用`purpose=manage`短期令牌，只删除限定平台/账号；普通导入令牌无权删除，manage令牌不能导入。
- 旧三表迁移前自动生成`collection.db.pre-v2-<随机ID>.db`，事务迁移；损坏JSON导致回滚，旧表及备份保留。旧数据超新配额时保留数据、限制后续写入。本轮只用临时库验收，未迁移正式库。
- 迁移副本/离线备份含历史源码，不随在线删除自动擦除，管理员需另定保留周期。当前令牌离线签发，无自助用户认证或撤销台账。

备份：`python scripts/collection_database.py backup --source <采集库> --destination <不存在的新备份文件>`。
恢复：`python scripts/collection_database.py restore --source <备份> --destination <不存在的新库文件>`。
两者使用SQLite backup API并核对完整性；恢复核对采集表，禁止覆盖。真实切换需先停止写入，再配置新库路径，不覆盖运行中的库。

## 5000条合成容量实测

| 场景（源码全部不同） | 逻辑用量 | checkpoint后DB | 导入期间采样DB+WAL+SHM峰值 | 本机导入耗时 |
|---|---:|---:|---:|---:|
| 无源码 | 4.33 MiB | 4.05 MiB | 7.91 MiB | 3.48秒 |
| 每份2 KiB | 15.25 MiB | 25.09 MiB | 29.11 MiB | 4.96秒 |
| 每份5 KiB | 29.90 MiB | 31.58 MiB | 36.07 MiB | 5.08秒 |

复算：`python scripts/check_collection_storage.py`；临时库、25条/批、ASCII合成源码。报告`output/collector/storage-check-2026-10-22.json`含精确字节；三种场景均经CLI备份/恢复、完整快照hash及外键/完整性检查。采样峰值不含备份副本，也不是瞬时磁盘极值；这是本机结构性测试，不是多人生产压测。

## 扩展与验收

- 扩展0.4.0预览仅最近50条；导出按25条逐块写文件；上传计划逐页生成，仅保存批次ID/区间/hash，上传只读当前批次；旧计划仍兼容。
- 本页上传/导出期间禁止重同步/任务切换，其他页面修改通过版本/摘要检查阻断错续；修复重新同步的未定义变量。413配额/401令牌错误中文提示；服务器确认计数正确才推进游标。
- 卸载流程见`collection-quickstart-2026-10-22.md`：确认服务器接收，或核对导出文件后可卸载，本地缓存/断点会丢失。
- 验证：274项pytest（5条既有警告）、24项Node测试；隔离Edge的导出/上传断点UI、合成CF worker、重同步去重与上传失败续传另有JSON报告。不使用真人账号或日常Edge profile。
- 仍待：四站真人覆盖验收、正式多人认证/部署、磁盘告警和峰值压测、商店发布。本地采集/导出无需购买服务器；2,000人全用满150 MiB约293 GiB，物理索引/WAL/备份另计。
