# 题目标注与离线评估

`scripts/evaluate.py` 在本地读取 `data/evaluation/authored_fixture.json`，不访问数据库、网络或付费模型，固定随机种子后生成 `report.json` 和 `report.md`。夹具包含 18 道跨领域题目及 5 名模拟学习者，所有题面、gold 标注、正负相关例和历史记录均标记 `provenance: authored_fixture`；它们是流程验证数据，不是人工研究样本或模型预测。

推荐比较两个排序器：`difficulty-fit-v1` 仅按难度匹配，`knowledge-tag-v2` 在难度适配之外加上标签薄弱度。报告包括 hit@k、MRR@k 与候选覆盖率。掌握度由模拟历史中每题最新算法判题结果启发式计算，CE 不作为算法证据；上述规则不是经过校准的学习概率。

标签 precision/recall/F1 与难度 MAE 只有在显式提供外部预测文件时计算：

```powershell
CodePowerPlus/Scripts/python.exe scripts/evaluate.py --output-dir data/evaluation/reports --seed 42 --k 5
CodePowerPlus/Scripts/python.exe scripts/evaluate.py --predictions predictions.json --output-dir data/evaluation/reports-pred
```

预测文件必须包含匹配的 `taxonomy_version`、`model_name`、`prompt_version`、`provenance`，并按 `problem_id` 覆盖每道题一次。未提供预测时报告状态为 `not_evaluated`，绝不会把 gold 标签当成预测。报告保留数据集版本、SHA-256、算法版本、样本量和局限，不能据此声称真实教学效果或泛化能力。

## 标注与预测文件约定

题目 `gold` 中的主知识点描述解题主线，次知识点只标注确有题面/解法证据的辅助知识，不因为解法里顺带出现某个概念就全都补进标签。当前 18 题采用单核心标签，复杂的多标签组合仍需新增独立评审样本。每个标签保存解释 `evidence`；难度是 Codeforces 风格的 800–3500 评分（100 的整数倍），由题目分析给出，与知识节点无关。

外部预测文件结构如下，`predictions` 需要补全数据集所有 `id`，顺序任意；未知标签照常作为错误计入 false positive，不能先过滤掉再汇报分数。

```json
{
  "taxonomy_version": "2026.09.3",
  "model_name": "填写实际模型或方法名称",
  "prompt_version": "填写实际提示词版本",
  "provenance": "填写实际采集来源，例如 independent_model_run",
  "predictions": [
    {
      "problem_id": 1,
      "primary_knowledge_ids": ["填写实际预测 ID"],
      "secondary_knowledge_ids": [],
      "difficulty": 1600
    }
  ]
}
```

上例只是格式说明，不是可声称已运行的预测。评估拒绝版本不一致、缺项、多余题目或重复 ID，避免通过只提交容易的题目抬高得分。完全空的标签预测允许评估，按漏标计算。`classification.micro` 将所有题目的集合交并累积后计算 precision/recall/F1；`sample_macro` 则对每题的指标做算术平均，分母为 0 的单项约定为 0。MAE 为所有题目难度绝对误差的均值。

## 推荐评估口径

- 学习者历史按数组顺序从旧到新排列，同一题只保留最新非 CE 的算法结果。复用生产公式 `services/profile.py` 的 `mastery_from_evidence`：每个知识 ID 用 `(1+最终 AC 的独立题数)/(2+有证据的独立题数)`，四舍五入至 4 位小数。例如仅一题最终 AC 为 0.6667、一题 AC 加一题 WA 为 0.5；重复尝试不会重复增加题数。没有出现过的知识不补造掌握度，排序时采用未知先验 0.5。历史任意一次 AC 的题目都从候选中排除。
- 主指标 `hit_at_k` 是前 k 个推荐中至少有一题属于自编正例的学习者比例。`mrr` 是 MRR@k：第一个正例在第 r 位时记 1/r，前 k 无正例记 0，再对全部学习者平均。
- `coverage` 分母是所有学习者各自可用候选的并集，分子是至少推荐过一次的不同题目数。已 AC 的题目不会出现在该学习者的结果中，但仍可能是其他学习者的候选。
- 知识树只有分类层级，没有先修关系，因此推荐指标不再包含“前置违例”；需要判断教学顺序时，用知识树的层级与题目证据人工核对。
- `negative_problem_ids` 是各场景明确的不适宜反例；其余未列为正例的候选也按不相关处理。这是小型夹具的评估约定，不能推断那些题对真人确实无用。
- 两种算法使用完全相同的题目、模拟历史和候选资格。正负相关标签只交给评估器，不能参与排序。gold 作为题目分析供排序，所以本实验是理想标签条件下的推荐比较，未计入真实模型标签错误。

运行默认不带时间戳，JSON 带数据集 SHA-256、版本、seed 和每名学习者排序明细；相同输入、代码、seed 和 k 的两次输出应一致。单测会在临时输出目录调用 CLI 两次比较 JSON，无需应用数据库。脚本支持 `--dataset` 和 `--taxonomy`，但当前夹具适配器要求 `authored_fixture`；未来真实数据应另写导入和隐私审查流程，保留真实来源及独立评审记录。
