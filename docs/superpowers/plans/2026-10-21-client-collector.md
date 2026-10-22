# Client Collector Implementation Plan

**Goal:** 可安装MV3采集预览版，四站页代理、可恢复本地任务、导出与独立鉴权导入存储。
**Architecture:** 页面同源采集→IndexedDB页级事务→预览JSON→受限导入API→独立SQLite。
**Tech Stack:** Chromium MV3/ES modules/IndexedDB，FastAPI/Pydantic/SQLite，node:test/pytest/DOM fixtures。
**Spec:** docs/superpowers/specs/2026-10-21-client-collector-design.md

- [x] Task 1 协议与鉴权：tests/test_collection.py先失败，再实现app/collection.py及app/api/collection.py；临时库验证绑定/幂等/旧库不变。
- [x] Task 2 页面代理（合成DOM/浏览器验证；真实站点实采仍未验收）：extensions/collector/tests，先验证序列化自包含代理+4站合成DOM、登录/挑战不当空页、账号核对。
- [x] Task 3 任务持久化：IndexedDB原子页/游标、租约、源码补采与暂停、worker报警唤醒；测试重放/重启/失败不会跳游标。
- [x] Task 4 任务页（Chromium/Edge临时profile验收）：沿最终模板实现，浏览器检查尺寸/无横溢出/文本安全；仅显式手势请求域名和上传。
- [x] Task 5 开发预览包与验证：ZIP审计通过；263项pytest、13项Node测试及两项临时浏览器集成通过；四站真实账号验收/商店分发未完成。
