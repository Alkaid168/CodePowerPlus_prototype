# 知识图谱首版内容说明（2026-10-22）

本次在现有分类词表之外新增 `data/knowledge_graph.json`，保存叶子知识点之间的学习前置关系与图谱层介绍纠错。词表仍是 `2026.10.1`，没有新增、删除、改名或重排分类节点。图的节点全集由当前词表的 **337 个叶子**提供；JSON 保存边与可选 `node_overrides`，没有边的叶子也属于图。

这份内容由 AI 代理根据当前叶子的名称、`summary` 和算法定义编纂，**未经教师或独立专家逐边审核**。`provenance` 固定标记为 `agent-curated-prerequisites-v1; not teacher-reviewed`。它不是从学生作答数据学出的图，不是教师金标准，也没有经过真实学习收益验证。

## 关系含义

`source → target` 表示：理解 `target` 的核心对象或当前叶子明确限定的算法机制，需要先理解 `source` 中相应的知识。每条 `reason` 写出实际依赖的概念或操作，不能用“相关”“更简单”“通常先教”代替原因。

例如，Trie → AC 自动机是因为后者的状态就是前者的前缀节点；Splay → LCT 是因为当前 LCT 叶子明确定义用 Splay 维护实链。它们不同于把“同属字符串”“都使用树”连成前置。

判断范围以叶子的实际说明为准。对于明确限定实现路线的叶子，保留该路线的组成算法，例如树链剖分、线段树与矩阵 → 当前动态 DP 叶子；这不声称所有文献中的动态 DP 都必须使用这一组合。对于并列了替代路线、又没有共同前置叶子的宽标签，不强行选择其中一条路线。

来源叶子有多种应用，并不意味着目标要使用它的所有应用。`reason` 只指出必要的核心含义；不能从一条边推导“必须完整刷完来源标签全部题目”。涉及宽标签而难以作出这一判断的关系，本版留空。

本图只记录正向、可解释的前置陈述。缺边表示本版没有表达该关系，不代表已经证明两点独立；孤立点也不代表零基础就能学。图中连通、可达和拓扑排序都不等于学生掌握度。

## 当前结构

现场核验结果为：**337 节点、189 条直接边，涉及 203 个节点，134 个孤立节点**。按忽略方向后的连通性计算，共 **157 个弱连通分量**，其中 23 个包含至少两个节点。非平凡分量的大小为：

`103, 21, 13, 10, 7, 5, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2`

全图有向无环，没有重复边、自环、分类节点端点或不在词表中的端点。已检查直接边的传递冗余；存在其他路径能够表达的直接边不重复保存。例如单分支 → 多重循环条件综合，已经可通过循环与嵌套循环到达，未另存一条直连。

| 领域 | 叶子节点 | 至少关联一条边的节点 | 以该域为目标的直接边 |
| --- | ---: | ---: | ---: |
| 语法 | 24 | 21 | 23 |
| 基础算法 | 22 | 11 | 7 |
| 搜索 | 9 | 6 | 6 |
| 动态规划 | 19 | 9 | 11 |
| 字符串 | 19 | 19 | 20 |
| 数学 | 95 | 51 | 41 |
| 数据结构 | 58 | 44 | 42 |
| 图论 | 59 | 33 | 30 |
| 计算几何 | 12 | 5 | 5 |
| 杂项 | 20 | 4 | 4 |
| 合计 | 337 | 203 | 189 |

“字符串全部节点参与关系”只是本次编纂结果，不能与其他领域的参与率作质量排名。尤其数学与杂项中的组合标签、替代方法和缺失基础节点较多，宁可保留多个分量，也不为视觉连通补边。

## 来源与查阅层次

1. **项目语义边界**：逐项读取当前 `data/knowledge_taxonomy.json` 的叶子 `id`、`name` 与 `summary`，据此决定现有标签究竟表示什么。名称不能覆盖说明，例如两种树套树按本项目实际 `summary` 判断内外层，不凭 ID 英文顺序猜测。
2. **算法内容依据**：各边的 `references` 指向 OI Wiki 对应算法或概念正文，图谱介绍覆盖也携带参考链接。最终共使用 146 个不同 URL，全部在本次取得的 OI Wiki 实时导航链接中核对过，避免凭空拼接不存在的地址。
3. **关键机制正文抽查**：本次读取 AC 自动机、IDA*、动态 DP、虚树、LCT、NTT、旋转卡壳、可持久化线段树、莫比乌斯反演、初等变换、圆方树、上下界网络流、全局平衡二叉树、多项式牛顿迭代、Main–Lorentz、形式幂级数复合与复合逆等关键页面正文，检查实际使用的结构与算法。
4. **编纂判断**：边的“是否足以称为必须先理解”仍是代理对算法机制的判断。没有逐字引文或教师签字；导航中存在 URL 也不等于逐篇完整审读。引用用来复查机制，不是把整个 OI Wiki 的阅读顺序转换成权威先修图。

关键可复查页面包括：

- [AC 自动机](https://oi-wiki.org/string/ac-automaton/)：Trie 状态与 fail 指针。
- [IDA*](https://oi-wiki.org/search/idastar/)：迭代阈值、DFS 与启发式代价。
- [动态 DP](https://oi-wiki.org/dp/dynamic/)：重链、矩阵转移与区间维护路线。
- [Link Cut Tree](https://oi-wiki.org/ds/lct/)：Splay 辅助树及 access。
- [快速数论变换](https://oi-wiki.org/math/poly/ntt/)：有限域单位根与原根。
- [旋转卡壳](https://oi-wiki.org/geometry/rotating-calipers/)：沿凸包边界维护支撑点。
- [圆方树](https://oi-wiki.org/graph/block-forest/)：点双分量与圆点、方点构造。
- [上下界网络流](https://oi-wiki.org/graph/flow/bound/)：用普通最大流求可行流及极值流。
- [Main–Lorentz](https://oi-wiki.org/string/main-lorentz/)：分治与 Z 函数计算跨中点扩展。

语法边引用 OI Wiki 中相应的变量、运算、分支、循环和数组基础说明；它们只支撑 C 与 C++ 共有的基础语义，不把 C++ 专属语法引入项目的 C 入门门槛。当前 JSON 本身仍以项目对 C 标签的说明为边界。

直接读取 GitHub 原始 Markdown 时曾发生连接重置；本轮改为读取 OI Wiki 网页，不把失败请求写成成功查阅。

## 独立代理语义复核与图谱层纠错

首轮结构校验后曾有 207 条边。另一代理独立审读边的语义后，指出其中 18 条仍把特定实现、概念介绍或组合标签当成了唯一必需的算法。本轮按更保守的口径删除这 18 条，得到最终 189 条。该复核仍是 AI 代理复核，**不是教师审核或专家金标准**；通过结构检查的边也可能需要继续修订。

| 本次删除的关系 | 复核原因 |
| --- | --- |
| 二维计算几何基础 → 反演、平面最近点对 | 目标只需部分点距或变换概念，不要求先掌握包含点积、叉积与多种判定的整个基础标签。 |
| 凸包 → 旋转卡壳 | 在已给定凸多边形上可以直接学习支撑线与卡壳，不要求先掌握构造凸包的算法。 |
| 阶与原根 → 高次剩余与单位根 | 原根是部分高次剩余求解路线，不是这个并列标签的统一前提。 |
| 数论分块 → 狄利克雷双曲线法与杜教筛 | 该组合叶子含不同方法，不能把杜教筛的常见优化升格为所有内容的必需前置。 |
| 普通生成函数 → 符号化方法 | 符号化方法也能直接通过指数生成函数学习，普通生成函数不是唯一入口。 |
| 裴蜀定理与一次不定方程 → 线性同余方程；线性同余方程 → 中国剩余定理 | 这是常见的构造推导路线，不能由此强制目标只通过该路线学习或求解。 |
| 最小割 → Stoer-Wagner | 学习全局割的算法不要求先掌握来源叶子中源汇最小割的算法与残量网络路线。 |
| 二叉搜索树 → Euler Tour Tree | ETT所需的是可切分拼接的序列维护结构，不强制有序关键字搜索树。 |
| 线性映射 → 对角化、Jordan标准型 | 可以从矩阵相似变换直接学习，不能把另一种数学叙述设为必须先学的独立标签。 |
| 图DFS → 支配树、双连通分量、桥、割点 | 所列算法可使用DFS，但宽标签还可通过其他定义或求解路线学习，不能以“可用Tarjan”等同“必须先学DFS”。 |
| 指数生成函数 → 伯努利数 | 指数生成函数是定义与推导路线之一，伯努利数也可通过递推等方式学习。 |
| 最大公约数 → 分解质因数 | Pollard-Rho使用gcd；该标签名称仍是分解质因数，试除等替代路线不要求gcd。 |

同时发现词表的 `graph.2-sat` 原介绍首句把 2-SAT 误写成限制“每个变量”的出现次数。正确限制是**每个子句至多包含两个文字，变量出现次数不限**。本次在图谱 JSON 的 `node_overrides.graph.2-sat.summary` 保存完整正确介绍，并附 OI Wiki 参考；图谱 API 应优先展示该覆盖。原 `knowledge_taxonomy.json` 和历史词表版本均没有改动，不能说历史词表错误已被修复。后续统一修订词表时，还需按版本、快照与兼容约定处理这项纠错。

## 有意排除的关系

| 未收入的关系 | 排除原因 |
| --- | --- |
| KMP → AC 自动机 | Wiki 建议先读 KMP，但 AC 的失配机制可以直接从 Trie 前后缀关系学习，不必先掌握单模式 KMP 完整算法。 |
| A* → IDA* | IDA*需要启发式估价与迭代加深，不需要先掌握 A* 的优先队列扩展实现。本版分别连接前两者。 |
| 离散对数 → NTT | Wiki 的前置阅读列表含离散对数，但计算 NTT 无须先求解离散对数问题。 |
| FFT → NTT；FFT 或 NTT → 全部多项式算法 | 变换可在不同代数体系内独立讲解；多项式乘法也有不同实现。当前简单边契约不能表达“FFT 或 NTT”。 |
| 二叉堆 → 所有最短路、A*、霍夫曼树、Slope Trick | 优先队列不只由二叉堆实现，有些目标还有不同解法。堆排序明确采用数组二叉堆，才保存二叉堆 → 堆排序。 |
| 并查集 → 最小生成树 | Kruskal需要并查集，Prim不需要；当前叶子同时包含两条路线。 |
| 倍增 → LCA；ST表 → LCA；线段树 → 树链剖分 | LCA可选倍增、RMQ或树剖；树剖的分解本身不要求线段树实现区间结构。 |
| 树直径 → 树中心 | 既可由直径求中心，也可逐层剥叶或换根，不把一种求解路线当全部路线的前置。 |
| 树重心 → 树分治 | 当前树分治叶子还包含边分治，不能把点分治的重心机制扩张到整个组合标签。 |
| 单调栈、单调队列 → 单调队列/单调栈优化 | 目标叶子把两类不同优化放在一起。两条边会被错误读成两者都必需，当前契约没有 OR 组。 |
| 单调栈 → 悬线法、笛卡尔树 | 单调栈是某些线性实现的工具，仍存在其他构造或维护方式；没有给当前宽标签添加统一硬限制。 |
| 插入排序 → 基数排序；计数排序 → 基数排序 | 基数排序需要稳定的每位排序，不指定必须是哪一种稳定排序算法。 |
| 逆元 ← 费马小定理或扩展欧几里得 | 求逆有替代路线，任取一条都不是所有模逆元学习的强制前驱。保留 gcd → 逆元表达互素条件。 |
| 数论分块 → 莫比乌斯反演 | 常用求和应用需要分块，但反演恒等式本身不以该优化为前提。 |
| 连分数 → Pell方程 | 连分数是求解路线之一，不能替代对方程本身的学习前提。 |
| 位操作 → 格雷码、一般线性基 | 位运算是常见编码或异或特例的工具，但当前目标不只有该实现或该代数域。 |
| OGF → EGF、多项式牛顿、复合、初等函数、Lagrange反演 | 这些目标需要形式幂级数概念，不意味着必须先掌握普通生成函数的组合计数方法。不能拿宽标签代替缺失的基础技能。 |
| 图匹配 → 二分图匹配或一般图匹配 | `graph.graph-matching.graph-match` 的说明还包含一般图带花树，不是单独的“匹配定义”叶子，不能将它当作纯基础概念。 |
| 最大流 → 所有费用流 | 指定流量的最小费用问题需要流与残量网络概念，不意味着必须先掌握最大流求解算法；缺少更窄的共有基础叶子。 |
| 固定文本输出 → 所有算法；语法全章 → 每个算法 | 语言入门的教学顺序不等于每个算法的具体前置；没有用基础语法节点人为连接全图。 |
| 分类父节点 → 子节点 | 分类只描述知识归属，不描述学习必要性，也不满足叶子端点约束。 |

本版只保留图 DFS → SCC：当前介绍的Tarjan与另一常见线性方案Kosaraju都依赖DFS。图 DFS → BCC、割点、桥、支配树已在独立复核后删除，不能把一种常用实现的步骤当成宽标签全部学习路径的前置。

## 当前词表不能完整表示的前置

- **动态规划基本原理**：没有单独叶子表示状态、阶段、转移、边界与计算顺序。不能拿“其他 DP”“计数 DP”或“记忆化搜索”充当所有 DP 的基础。
- **最短路的具体算法**：缺少可用的 Dijkstra、Bellman–Ford、Floyd 等叶子。不能把最短路分类或二叉堆替代这些算法，差分约束、同余最短路、最小环等相关前置因此未补齐。
- **普通莫队**：没有可用普通莫队叶子，不能把带修改莫队先学完作为树上莫队、回滚莫队等的共同门槛。只保留树上莫队明确使用的 LCA，以及 bitset 版本明确使用的二进制集合。
- **通用优先队列、双端队列、可并堆接口**：缺少相应的中性基础叶子。可持久化可并堆不能强制要求左偏树或配对堆中的某一个；Huffman也不强制要求某个特定堆实现。
- **形式幂级数、多项式四则运算与快速乘法接口**：不能由 OGF、FFT 或 NTT 单独替代。多项式算法之间虽有大量可教学的路线，本版不把其中一条路线升格为唯一硬前置。
- **模运算基本定义、一般流与残量网络、匹配定义、极小极大搜索、群作用和导数积分基础**：分别影响部分数论、费用流、匹配、Alpha-Beta、Pólya和数值算法关系。当前宽标签不能无条件代替这些细概念。
- **AND/OR与范围元数据**：现有边只有端点、原因和参考，不支持“会其中任一算法即可”、同一目标不同实现路线、独立审核状态。保守缺边比暗中把 OR 需求写成 AND 更可靠。

后续若确需补这些前置，应该先独立讨论标签粒度与题目可标注性，再版本化词表；本次没有为了图连通擅自扩词表。当前所有孤立节点仍须完整出现在节点 API、领域筛选与搜索中。

## 复核方法

结构检查只读 JSON，不访问数据库、不调用模型，也不产生学生作答记录。在仓库根目录用 PowerShell 执行以下命令，可复算端点、环、重复边、冗余边与连通统计：

```powershell
@'
import json
from collections import deque
from pathlib import Path

taxonomy = json.loads(Path("data/knowledge_taxonomy.json").read_text(encoding="utf-8"))
graph = json.loads(Path("data/knowledge_graph.json").read_text(encoding="utf-8"))
parents = {node["parent_id"] for node in taxonomy["nodes"]}
nodes = {node["id"] for node in taxonomy["nodes"] if node["id"] not in parents}
assert graph["taxonomy_version"] == taxonomy["version"]
assert graph["provenance"] == "agent-curated-prerequisites-v1; not teacher-reviewed"
assert set(graph["node_overrides"]) == {"graph.2-sat"}
override = graph["node_overrides"]["graph.2-sat"]
assert "每个子句至多包含两个文字" in override["summary"]
assert "变量出现次数不限" in override["summary"]
assert 20 <= len(override["summary"]) <= 400
assert override["references"] == ["https://oi-wiki.org/graph/2-sat/"]
adj = {node: set() for node in nodes}
undirected = {node: set() for node in nodes}
degree = dict.fromkeys(nodes, 0)
for edge in graph["edges"]:
    source, target = edge["source"], edge["target"]
    assert source in nodes and target in nodes
    assert source != target and target not in adj[source]
    assert edge["reason"].strip() and edge["references"]
    assert all(url.startswith("https://oi-wiki.org/") for url in edge["references"])
    adj[source].add(target)
    undirected[source].add(target)
    undirected[target].add(source)
    degree[target] += 1
queue = deque(node for node in nodes if degree[node] == 0)
order = []
while queue:
    node = queue.popleft()
    order.append(node)
    for target in adj[node]:
        degree[target] -= 1
        if degree[target] == 0:
            queue.append(target)
assert len(order) == len(nodes), "cycle"
reach = {node: set() for node in nodes}
for node in reversed(order):
    for target in adj[node]:
        reach[node] |= {target} | reach[target]
assert not [(s, t) for s in nodes for t in adj[s]
            if any(t in reach[v] for v in adj[s] if v != t)], "redundant"
seen, sizes = set(), []
for node in nodes:
    if node in seen:
        continue
    stack, size = [node], 0
    seen.add(node)
    while stack:
        current = stack.pop()
        size += 1
        for target in undirected[current]:
            if target not in seen:
                seen.add(target)
                stack.append(target)
    sizes.append(size)
print({
    "nodes": len(nodes), "edges": len(graph["edges"]),
    "involved": sum(bool(undirected[node]) for node in nodes),
    "isolates": sizes.count(1), "weak_components": len(sizes),
    "nontrivial_components": sum(size > 1 for size in sizes),
})
'@ | python -
```

预期输出：`nodes=337, edges=189, involved=203, isolates=134, weak_components=157, nontrivial_components=23`。内容复核需逐条阅读 `reason` 并检查替代路线；结构脚本通过不能证明每条教育关系正确。
