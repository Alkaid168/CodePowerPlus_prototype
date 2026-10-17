"""题目推荐与学习路径。

知识树只提供“这道题考什么”的标签，因此推荐只用两个信号：
- 标签薄弱度：1 - 已掌握程度（没有证据时按先验 0.5 处理）；
- 难度适配：题目评分与当前水平期望评分的接近程度（评分是 Codeforces 风格的 800–3500）。
学习路径就是目标在知识树上的层级（领域 → 分支 → 知识点）。
"""
from __future__ import annotations

from app.services.difficulty import band_name

ALGORITHM_VERSION = 'knowledge-tag-v2'
WEAKNESS_WEIGHT = 0.6
FIT_WEIGHT = 0.4
UNKNOWN_MASTERY = 0.5
# 期望评分随掌握度线性上移：完全没掌握约 1200 分，完全掌握约 2800 分。
EXPECTED_RATING_BASE = 1200
EXPECTED_RATING_SPAN = 1600
# 评分差距达到 800 分时难度适配分降到 0。
FIT_TOLERANCE = 800


def tags_of(analysis: dict) -> list[str]:
    return list(analysis.get('primary_knowledge_ids', [])) + list(analysis.get('secondary_knowledge_ids', []))


def approved_analysis(problem: dict, taxonomy) -> dict | None:
    """只有当前版本、已审核、标签合法的分析才能参与推荐。"""
    analysis = problem.get('analysis') or {}
    ids = tags_of(analysis)
    if (analysis.get('review_status') != 'approved'
            or analysis.get('is_stale')
            or analysis.get('taxonomy_version') != taxonomy.version
            or not taxonomy.allowed(ids)):
        return None
    return analysis


def recommend(problems: list[dict], mastery: dict, solved_ids: set | list, taxonomy, limit: int = 10) -> list[dict]:
    solved = set(solved_ids)
    scored = []
    for problem in problems:
        if problem['id'] in solved:
            continue
        analysis = approved_analysis(problem, taxonomy)
        if analysis is None:
            continue
        ids = tags_of(analysis)
        if not ids:
            continue
        average = sum(mastery.get(node_id, UNKNOWN_MASTERY) for node_id in ids) / len(ids)
        weakness = 1 - average
        difficulty = analysis.get('difficulty')
        desired = EXPECTED_RATING_BASE + EXPECTED_RATING_SPAN * average
        fit = max(0.0, 1 - abs((difficulty if isinstance(difficulty, int) else desired) - desired) / FIT_TOLERANCE)
        score = round(WEAKNESS_WEIGHT * weakness + FIT_WEIGHT * fit, 4)
        names = [taxonomy.get(node_id)['name'] for node_id in ids]
        reasons = [f'练习知识点：{"、".join(names)}',
                   f'题目评分 {difficulty}（{band_name(difficulty)}），'
                   f'当前期望评分约 {round(desired / 100) * 100}，匹配分 {fit:.2f}']
        if all(node_id not in mastery for node_id in ids):
            reasons.append('这些知识点尚无做题证据，可用本题初步评估')
        else:
            reasons.append('按当前薄弱知识点排序')
        scored.append({
            'problem_id': problem['id'], 'title': problem['title'],
            'source_url': problem.get('source_url', ''),
            'difficulty': difficulty, 'difficulty_band': band_name(difficulty),
            'recommendation_score': score,
            'target_knowledge_ids': ids, 'target_knowledge_names': names, 'reasons': reasons,
            'score_breakdown': {'weakness': round(weakness, 4), 'difficulty_fit': round(fit, 4)},
            'algorithm_version': ALGORITHM_VERSION,
        })
    return sorted(scored, key=lambda item: (-item['recommendation_score'], item['problem_id']))[:limit]


def learning_path(problems: list[dict], mastery: dict, solved_ids: set | list, taxonomy,
                  target_id: str | None = None) -> list[dict]:
    if target_id:
        if not taxonomy.allowed([target_id]):
            raise ValueError('请选择有效的 L2 或 L3 知识点作为目标')
        targets = [target_id]
    else:
        targets = list(dict.fromkeys(
            node_id for item in recommend(problems, mastery, solved_ids, taxonomy, limit=3)
            for node_id in item['target_knowledge_ids']))
    solved = set(solved_ids)
    candidates = [(problem, approved_analysis(problem, taxonomy)) for problem in problems if problem['id'] not in solved]
    steps, seen = [], set()
    for target in targets:
        chain = [node['id'] for node in taxonomy.ancestors(target)] + [target]
        for node_id in chain:
            if node_id in seen:
                continue
            seen.add(node_id)
            node = taxonomy.get(node_id)
            problem_ids = [problem['id'] for problem, analysis in candidates
                           if analysis is not None and node_id in tags_of(analysis)]
            if node['level'] == 1:
                reason = '所属领域'
            elif node_id == target:
                reason = '目标知识点'
            else:
                reason = '所属分支'
            if not problem_ids:
                reason += '；当前没有关联的已审核题目'
            steps.append({'knowledge_id': node_id, 'name': node['name'], 'level': node['level'],
                          'reason': reason, 'mastery': mastery.get(node_id), 'problem_ids': problem_ids})
    return steps
