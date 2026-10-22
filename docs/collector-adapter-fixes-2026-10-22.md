# 采集助手0.4.2：VJudge、AtCoder与任务删除

## 已验证原因

- 用户报告VJudge正常登录但扩展无法识别。日常Edge只读DOM核对：账号为`#userNameDropdown`，同一父节点内`.user-dropdown a[data-i18n="top.nav.profile"]`指向本人资料；旧`#nav-user a[href^="/user/"]`不存在。修复从新控件的资料链接识别，核对下拉框账号一致，兼容旧导航，不从任意用户链接猜本人。
- AtCoder失败地址`/contests/abc480/submissions?lang=en&f.User=<本人>&page=1`正常显示All Submissions、本人筛选和`.panel-body`内“No Submissions”，没有提交表格。旧实现要求必须存在表格，因此HTTP200也报schema_changed。修复要求比赛匹配的表单、本人筛选、提交标题及明确空结果同时满足才完成该比赛，随后继续下一比赛。未知/错误页仍暂停，不当作空历史。
- 真人页面只读核对了这些DOM特征，没有复制cookie、登录、导出源码或操作用户真实任务；不能据此声称完整真人采集验收通过。

## 删除语义

- 每张任务卡新增“删除本地任务”；确认框明确停止、删除本任务记录/源码/上传断点及不可撤销，不影响其他任务、服务器已接收数据或独立导出文件。
- IndexedDB单事务删除tasks、records、uploads，按taskId范围清理；采集中也可删除，已经发出的单次请求可能仍返回，commit发现任务不存在便不保存。
- 修复迟到重同步/继续操作重建任务的窗口：重同步事务核对旧任务状态、版本、租约；继续时绑定标签页与切状态同事务。上传断点保存也需任务存在，删除后不会留下新孤儿检查点。
- 未更改IndexedDB版本、服务端表结构或接口；更新覆盖原扩展目录后“重新加载”，不要卸载。AtCoder旧任务点“继续”；VJudge重新识别；删除只由用户明确确认执行。

## 验证

- 30项Node测试通过；新增测试先复现VJudge识别失败、AtCoder空页误报、缺失删除功能，再修复通过。覆盖错误账号/未知页面拒绝、跨任务隔离、在途commit/reset/upload保存不能复活任务。
- 隔离Edge `browser-check.mjs`：真实IndexedDB、删除取消/确认、三表清理、原预览/导出/断点、1280/1024/390布局，无控制台错误。
- 隔离Edge `adapter-check.mjs`：合成当前VJudge导航识别和元数据分页；AtCoder空比赛→下一比赛→源码保存。初版测试的异步waitForFunction未可靠等待IndexedDB状态，改用有界显式读取并验证最终状态；未据此改动生产采集调度。
- 隔离Edge `worker-check.mjs`：原合成CF采集/重同步去重及HTTP413上传续传通过。本轮未改后端，不重复无关pytest；未部署、上架或提交其他模块改动。
- 报告：`output/playwright/collector/browser-check.json`、`adapter-check.json`、`worker-check.json`；全部浏览器完整流程是隔离合成测试。
