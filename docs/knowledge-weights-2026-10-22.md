# 知识点难度权重与重要权重

2026-10-22。已实现两个数字与展示；本轮未将它们接入推荐算法。

## 数据约定

- `difficulty_weight`：整数1–8，依次对应红、橙、黄、绿、青、蓝、紫、黑。红按用户约定代表700分及以下；其余颜色参考洛谷模板难度，不另编精确分数线，也不展示“入门/基础”等档位文字。
- `importance_weight`：整数1–5，显示相同数量纯黑星。按一般算法竞赛、偏ICPC训练的常见程度与基础价值编纂，是当前课程判断，不是统计测得的考频比例。
- 数据在`data/knowledge_weights.json`，覆盖全部377个分类/知识节点；图谱只展示其中337个叶子。父级分支按进入该领域的代表内容标注，不取最难后代，也不意味着掌握分支内全部算法。
- 原`knowledge_taxonomy.json`及`knowledge_graph.json`不改；独立注解绑定词表版本，知识树、搜索、两种详情路径与图谱API统一读取。不存在额外复杂学习模型。
- API遇到缺节点、额外节点、版本不匹配、非整数/越界、重复JSON字段或文件不可读，返回明确503错误，不静默降成红色/一星。

全量可读表见[标注清单](knowledge-weights-catalog-2026-10-22.md)，包括非叶子分支。所有未逐点核对模板的条目均为代理逐项估计，尚未由用户/教师审核这批新权重。此前图谱审核不视作本批权重审核。

## 实际核对的洛谷资料

2026-10-22匿名读取官方`https://www.luogu.com.cn/_lfe/config`的`ProblemDifficulty`，其1–8对应`pink/orange/gold/green/cyan/blue/purple/lapis`，确认八档顺序。页面数字由官方页面的`lentille-context.data.problem.difficulty`取得。以下14份题目页面均HTTP200，读取了题名、评级与题面范围。

| 模板 | 当前洛谷颜色 | 本项目用法 |
| --- | --- | --- |
| [P3808 AC自动机简单版](https://www.luogu.com.cn/problem/P3808)、[P3796 简单版II](https://www.luogu.com.cn/problem/P3796)、[P5357 AC自动机](https://www.luogu.com.cn/problem/P5357) | 均蓝6 | 用户明确无拓扑版本青5、拓扑计数蓝6，优先用户锚点。现有单一AC节点描述失配指针/多模式匹配，按基础版本青5，不拆改词表 |
| [P5056 插头DP](https://www.luogu.com.cn/problem/P5056) | 黑8 | 与用户锚点一致 |
| [P3374 树状数组1](https://www.luogu.com.cn/problem/P3374)、[P3372 线段树1](https://www.luogu.com.cn/problem/P3372) | 绿4 | 作为常用区间结构锚点 |
| [P5854 笛卡尔树](https://www.luogu.com.cn/problem/P5854) | 绿4 | 按模板构建程度取4，不因名称陌生直接标成紫黑 |
| [P3865 ST表/RMQ](https://www.luogu.com.cn/problem/P3865)、[P3366 最小生成树](https://www.luogu.com.cn/problem/P3366) | 黄3 | 简单静态查询及图论模板锚点 |
| [P3805 Manacher](https://www.luogu.com.cn/problem/P3805) | 青5 | 按模板取5 |
| [P3809 SA](https://www.luogu.com.cn/problem/P3809)、[P3806 点分治](https://www.luogu.com.cn/problem/P3806) | 蓝6 | 按模板取6 |
| [P3376 最大流](https://www.luogu.com.cn/problem/P3376)、[P3381 费用流](https://www.luogu.com.cn/problem/P3381) | 蓝6 | 与猫树等结构区分难度和重要性：最大流6/5，猫树估计6/1 |

未声称全377点均有官方模板或已逐一核对。猫树6/1、反演7/1等为本项目标注估计；不存在通过真实用户数据校准的准入分数。原网页/配置、URL、状态及SHA256收据保存在忽略目录`output/knowledge-weights-2026-10-22/`，不将含题面与无关用户资料的原响应写入仓库。

## 展示

- 知识树和图谱详情共用`knowledgeTitle`：名字后接细黑外环、白色间隔和彩色内圆，再接“重要度：”及相应黑星。窄屏可换行。颜色有中文title/aria-label，星数有无障碍名称，不依赖色觉识别。
- 球面保留白色，选中保留黑色，连线保持灰色。外缘按难度画静态透明衰减光晕，纹理按颜色缓存，不逐帧创建渐变；离页清理缓存。此为用户明确授权的语义色例外，已同步最终模板。
- 无新增权重编辑器、筛选器、徽标说明长文案，也不更改现有拖甩、缩放、搜索或先修关系。

## 验证

- 新接口一致性测试先失败于缺少权重，再实现；权重相关及知识API36项通过。完整隔离pytest **361通过**，1条既有Starlette/anyio弃用警告。
- Node原图谱布局与手势 **17项通过**；ES模块 **32个解析通过**。
- 实际无头Edge核对知识树5个代表节点、图谱双视图、全部8色已绘制及光晕alpha向外递减。覆盖1440/1280/1024/390宽度、长标题、黑边/白间隔/内芯实际颜色、黑星数量、关系跳转、减少动态，0控制台错误。截图和收据见`output/playwright/knowledge-weights/`。
- 原交互脚本另回归真实拖动/甩动、空白平移、滚轮锚定缩放、CDP双指缩放、科技树静止/滚动/键盘、IME、深链接、离页清理，全部通过。收据在`output/playwright/knowledge-weights-regression/`。
- 看图发现首版圆环内芯透明：DOM辅助函数不支持对象形式CSS自定义属性，已补实际颜色断言、复现失败并改用有效style文本，重测通过。不将仅存在圆圈DOM作为着色成功。
- 浏览器预览使用`127.0.0.1:8047`内存数据库。未写正式学习库、调用模型或操作真实账号；原图/词表与作者笔记另做指纹核对。未提交推送。
