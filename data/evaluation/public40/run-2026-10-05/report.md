# 公开真题辅助评估

完成 40 / 40 题；词表 2026.09.9；模型 deepseek-chat；提示词 problem-analysis-v5。

**标签参考来源：代理独立辅助核对，未经教师审核。以下指标不代表真实教学准确率。**

| 来源 | 完成 | 标签 micro F1 | 官方 CF 评分 MAE | 代理估计评分 MAE |
| --- | ---: | ---: | ---: | ---: |
| codeforces | 20 | 0.581 | 140.0 | 115.0 |
| luogu | 20 | 0.578 | 不适用 | 150.0 |

## 来源与局限

- 标签参考由代理独立核对题意生成，未经教师／双人独立人工审核，不是人工金标准；F1 只表示与辅助参考的一致性。
- CF 官方标签粒度与本项目词表不同，保留作来源参考，不直接等同本项目标签。
- CF 官方评分可直接计算误差；洛谷等级不转换成官方 CF 评分，另列代理估计评分误差。
- 公开经典题可能被模型在训练中见过；隐藏来源和官方评分不构成严格盲测，不代表学校新题上的泛化表现。
- 题面按官方技术条件独立重述；原题故事与语言差异可能影响结果，样例来源见逐题采集记录。
- 这批题仅作为题库和初步诊断数据，不产生真实学生记录或教学效果结论。

- 706B 在常规重试后仍有父子标签冲突；追加 2 次同一 v5 提示词校验修复调用，修复对话包含模型自己被拒的响应，不含辅助参考或官方评分。该题采用了额外修复步骤，不能把最终 40/40 视为首轮成功率。

- 洛谷 P1001 使用官方样例，其余 19 题使用明确注明来源并经独立算法检查的自编样例，不能称为官方样例。

## 逐题差异

| 题目 | 来源 | 模型分 | 官方 CF 分 | 缺少标签 | 多出标签 |
| --- | --- | ---: | ---: | --- | --- |
| [P1001](https://www.luogu.com.cn/problem/P1001) | luogu | 800 | — | — | — |
| [P1047](https://www.luogu.com.cn/problem/P1047) | luogu | 900 | — | 差分 | 枚举、排序 |
| [P1055](https://www.luogu.com.cn/problem/P1055) | luogu | 800 | — | 字符串基础 | 位操作 |
| [P1219](https://www.luogu.com.cn/problem/P1219) | luogu | 1400 | — | — | 枚举 |
| [P1002](https://www.luogu.com.cn/problem/P1002) | luogu | 1000 | — | 计数 DP | 模拟、其他 DP |
| [P1048](https://www.luogu.com.cn/problem/P1048) | luogu | 1200 | — | — | — |
| [P1064](https://www.luogu.com.cn/problem/P1064) | luogu | 1600 | — | — | 枚举 |
| [P1091](https://www.luogu.com.cn/problem/P1091) | luogu | 1400 | — | — | 枚举 |
| [P1020](https://www.luogu.com.cn/problem/P1020) | luogu | 1600 | — | — | 树状数组、序理论 |
| [P3371](https://www.luogu.com.cn/problem/P3371) | luogu | 1400 | — | 二叉堆 | 堆、图论基础 |
| [P3366](https://www.luogu.com.cn/problem/P3366) | luogu | 1300 | — | — | 排序、图论基础 |
| [P3367](https://www.luogu.com.cn/problem/P3367) | luogu | 1200 | — | — | — |
| [P3368](https://www.luogu.com.cn/problem/P3368) | luogu | 1200 | — | 线段树基础 | 前缀和 |
| [P3383](https://www.luogu.com.cn/problem/P3383) | luogu | 2400 | — | — | 枚举、前缀和、素数 |
| [P3385](https://www.luogu.com.cn/problem/P3385) | luogu | 1600 | — | — | 图论基础、图上广度优先搜索（BFS）、图上深度优先搜索（DFS） |
| [P3375](https://www.luogu.com.cn/problem/P3375) | luogu | 1400 | — | — | 字符串基础、字符串匹配 |
| [P3808](https://www.luogu.com.cn/problem/P3808) | luogu | 1700 | — | — | 排序、树状数组、树上问题、前缀函数与 KMP 算法 |
| [P4779](https://www.luogu.com.cn/problem/P4779) | luogu | 1500 | — | 二叉堆 | 堆、图论基础 |
| [P1075](https://www.luogu.com.cn/problem/P1075) | luogu | 1200 | — | — | 素数 |
| [P1115](https://www.luogu.com.cn/problem/P1115) | luogu | 1100 | — | — | 枚举、贪心 |
| [4A](https://codeforces.com/problemset/problem/4/A) | codeforces | 800 | 800 | 数论 | 数论基础 |
| [71A](https://codeforces.com/problemset/problem/71/A) | codeforces | 800 | 800 | — | 模拟 |
| [231A](https://codeforces.com/problemset/problem/231/A) | codeforces | 800 | 800 | — | — |
| [158A](https://codeforces.com/problemset/problem/158/A) | codeforces | 800 | 800 | — | 枚举 |
| [50A](https://codeforces.com/problemset/problem/50/A) | codeforces | 1500 | 800 | 构造、贪心 | 枚举、轮廓线 DP、状压 DP |
| [282A](https://codeforces.com/problemset/problem/282/A) | codeforces | 800 | 800 | — | — |
| [112A](https://codeforces.com/problemset/problem/112/A) | codeforces | 800 | 800 | — | 模拟 |
| [339A](https://codeforces.com/problemset/problem/339/A) | codeforces | 800 | 800 | 排序应用、字符串基础 | 模拟 |
| [1A](https://codeforces.com/problemset/problem/1/A) | codeforces | 800 | 1000 | 构造、数论 | 模拟 |
| [230B](https://codeforces.com/problemset/problem/230/B) | codeforces | 1300 | 1300 | — | 二分、数论基础 |
| [580A](https://codeforces.com/problemset/problem/580/A) | codeforces | 800 | 900 | 其他 DP | 枚举 |
| [455A](https://codeforces.com/problemset/problem/455/A) | codeforces | 1500 | 1500 | — | 计数排序、前缀和 |
| [474B](https://codeforces.com/problemset/problem/474/B) | codeforces | 900 | 1200 | — | 枚举 |
| [706B](https://codeforces.com/problemset/problem/706/B) | codeforces | 900 | 1100 | 前缀和、排序应用 | 排序 |
| [279B](https://codeforces.com/problemset/problem/279/B) | codeforces | 1200 | 1400 | — | — |
| [363B](https://codeforces.com/problemset/problem/363/B) | codeforces | 900 | 1100 | 双指针 | 枚举、模拟 |
| [520B](https://codeforces.com/problemset/problem/520/B) | codeforces | 1500 | 1400 | — | 二分 |
| [545C](https://codeforces.com/problemset/problem/545/C) | codeforces | 1500 | 1500 | 其他 DP | — |
| [25D](https://codeforces.com/problemset/problem/25/D) | codeforces | 1500 | 1900 | — | 连通性相关、树基础 |
| [20C](https://codeforces.com/problemset/problem/20/C) | codeforces | 1500 | 1900 | 二叉堆 | 堆、图论基础 |

逐题题面、样例来源和辅助参考见 manifest.json；真实模型输出及断点见 predictions.json；导入编号见 import.json。
