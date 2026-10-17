# v8首测难度比较（人评修订1）

用户将CF25D人工分1900更正为1500；模型预测不变，原始比较保留在human-revisions/r0。

差值 = 模型 − 人工；负值表示模型低估。

| 组别 | 题数 | MAE | 中位绝对差 | 有向均差 | ≤100 | ≤200 | ≤300 | 最大绝对差 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all20 | 20 | 170.0 | 150.0 | -60.0 | 50.0% | 75.0% | 90.0% | 400 |
| regression9 | 9 | 155.6 | 200.0 | -88.9 | 44.4% | 77.8% | 100.0% | 300 |
| new11 | 11 | 181.8 | 100.0 | -36.4 | 54.5% | 72.7% | 81.8% | 400 |

| ID | 原题 | 模型 | 人工 | 差值 |
| --- | --- | --- | --- | --- |
| B01 | [原题](https://www.luogu.com.cn/problem/P3368) | 1400 | 1100 | +300 |
| B02 | [原题](https://codeforces.com/problemset/problem/363/B) | 800 | 1100 | -300 |
| B03 | [原题](https://www.luogu.com.cn/problem/P3390) | 1300 | 1500 | -200 |
| B04 | [原题](https://www.luogu.com.cn/problem/P1141) | 1100 | 1000 | +100 |
| B05 | [原题](https://www.luogu.com.cn/problem/P1352) | 1400 | 1300 | +100 |
| B06 | [原题](https://codeforces.com/problemset/problem/706/B) | 1100 | 1100 | +0 |
| B07 | [原题](https://www.luogu.com.cn/problem/P3808) | 1700 | 1700 | +0 |
| B08 | [原题](https://www.luogu.com.cn/problem/P3386) | 1400 | 1500 | -100 |
| B09 | [原题](https://www.luogu.com.cn/problem/P1880) | 1500 | 1400 | +100 |
| B10 | [原题](https://codeforces.com/problemset/problem/520/B) | 1200 | 1400 | -200 |
| B11 | [原题](https://www.luogu.com.cn/problem/P1044) | 1100 | 1500 | -400 |
| B12 | [原题](https://codeforces.com/problemset/problem/474/B) | 1100 | 1200 | -100 |
| B13 | [原题](https://www.luogu.com.cn/problem/P3370) | 800 | 1100 | -300 |
| B14 | [原题](https://codeforces.com/problemset/problem/279/B) | 1100 | 1300 | -200 |
| B15 | [原题](https://www.luogu.com.cn/problem/P1803) | 1400 | 1000 | +400 |
| B16 | [原题](https://www.luogu.com.cn/problem/P1440) | 1400 | 1300 | +100 |
| B17 | [原题](https://codeforces.com/problemset/problem/25/D) | 1400 | 1500 | -100 |
| B18 | [原题](https://www.luogu.com.cn/problem/P3372) | 1500 | 1700 | -200 |
| B19 | [原题](https://www.luogu.com.cn/problem/P1226) | 1100 | 1100 | +0 |
| B20 | [原题](https://www.luogu.com.cn/problem/P3383) | 1100 | 1300 | -200 |
