# Offline evaluation / 离线流程验证

Dataset: `authored-fixture-2026.09.17-v2` · taxonomy: `2026.09.9` · seed: 42
Provenance: **authored_fixture** · samples: {"problems": 18, "learners": 5, "history_records": 15}
Algorithms: `{"baseline": "difficulty-fit-v1", "graph": "knowledge-tag-v2", "mastery": "independent-problem-evidence-v1"}`

| Method | hit@k | MRR@k | Coverage | Shown |
|---|---:|---:|---:|---:|
| baseline (k=5) | 0.4000 | 0.2667 | 0.3333 | 25 |
| graph (k=5) | 0.8000 | 0.7000 | 0.4444 | 25 |

## External analysis predictions

Status: **not_evaluated**

```json
{
  "status": "not_evaluated",
  "reason": "No external predictions supplied; gold is never used as predictions.",
  "classification": null,
  "difficulty_mae": null,
  "samples": 0
}
```

## Limits / 数据来源与局限

- 全部题面、gold 和相关性正负例由代理为测试自编，学习者及提交为模拟数据；没有真实参与者，没有模型预测，也没有教师批准。
- This small authored_fixture dataset validates mechanics, not real learning outcomes or generalization.
- Positive/negative relevance examples were authored for scenarios, not independently assessed; unlisted candidates are treated as non-relevant for hit/MRR.
- Recommendations use fixture gold analyses, so this is an oracle-label ranking experiment and excludes prediction errors.
- Mastery uses only simulated history: latest non-CE result per problem; (1+final AC problem count)/(2+independent problem count) per knowledge ID, reusing the production formula in services/profile.py. These are heuristics, not calibrated learning probabilities.
- Difficulty-only baseline targets 1200+1600*mean(observed mastery) on the 800-3500 Codeforces-style scale; the knowledge ranker adds tag weakness on top. Neither is tuned on real outcomes.
- MRR is truncated at k; coverage denominator is the union of all learner-eligible candidates.
- No API, real user, or database is used; no automatic paid prediction calls. Use external predictions to evaluate labels/difficulty.

Per-learner rankings, known mastery and held-out relevance are preserved in `report.json`.
