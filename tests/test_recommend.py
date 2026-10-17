"""推荐与学习路径：只用当前版本、已审核的题目，并排除已 AC。"""
import pytest

from app.knowledge import Taxonomy
from app.services.recommend import learning_path, recommend


def problem(problem_id, ids, *, difficulty=1600, status='approved', version=None, title=None):
    return {
        'id': problem_id,
        'title': title or f'题{problem_id}',
        'source_url': 'https://example.com/p/1',
        'analysis': {
            'primary_knowledge_ids': list(ids),
            'secondary_knowledge_ids': [],
            'difficulty': difficulty,
            'review_status': status,
            'taxonomy_version': version or Taxonomy().version,
        },
    }


def test_only_approved_current_version_problems_are_candidates():
    taxonomy = Taxonomy()
    items = [
        problem(1, ['math.number-theory.prime']),
        problem(2, ['math.number-theory.prime'], status='pending'),
        problem(3, ['math.number-theory.prime'], version='2020.01.1'),
        problem(4, ['invented']),
    ]
    result = recommend(items, {}, [], taxonomy)
    assert [item['problem_id'] for item in result] == [1]


def test_weak_tag_and_difficulty_fit_drive_the_score():
    taxonomy = Taxonomy()
    weak = problem(1, ['math.number-theory.prime'], difficulty=1600)
    strong = problem(2, ['math.number-theory.gcd'], difficulty=1600)
    mastery = {'math.number-theory.prime': 0.1, 'math.number-theory.gcd': 0.9}
    result = recommend([weak, strong], mastery, [], taxonomy)
    assert [item['problem_id'] for item in result] == [1, 2]
    assert result[0]['recommendation_score'] > result[1]['recommendation_score']
    assert set(result[0]['score_breakdown']) == {'weakness', 'difficulty_fit'}
    assert result[0]['target_knowledge_names'] == ['素数']
    assert result[0]['difficulty_band'] == '进阶'
    assert result[0]['reasons'] and result[0]['algorithm_version']


def test_solved_problems_are_excluded():
    taxonomy = Taxonomy()
    items = [problem(1, ['math.number-theory.prime'])]
    assert recommend(items, {}, [1], taxonomy) == []


def test_learning_path_walks_tree_levels_and_attaches_problems():
    taxonomy = Taxonomy()
    items = [problem(1, ['math.number-theory.prime'])]
    steps = learning_path(items, {}, [], taxonomy, 'math.number-theory.prime')
    assert [step['knowledge_id'] for step in steps] == ['math', 'math.number-theory', 'math.number-theory.prime']
    assert [step['level'] for step in steps] == [1, 2, 3]
    assert steps[-1]['problem_ids'] == [1]
    assert steps[0]['problem_ids'] == [] and steps[1]['problem_ids'] == []
    assert steps[-1]['reason'].startswith('目标知识点')


def test_learning_path_rejects_l1_or_unknown_target():
    taxonomy = Taxonomy()
    with pytest.raises(ValueError):
        learning_path([], {}, [], taxonomy, 'math')
    with pytest.raises(ValueError):
        learning_path([], {}, [], taxonomy, 'not.exists')


def test_learning_path_without_target_uses_weakest_recommendations():
    taxonomy = Taxonomy()
    items = [problem(1, ['math.number-theory.prime'], difficulty=1600)]
    steps = learning_path(items, {'math.number-theory.prime': 0.1}, [], taxonomy)
    assert steps[-1]['knowledge_id'] == 'math.number-theory.prime'


def test_expected_rating_scales_with_mastery():
    """期望评分随掌握度上移：掌握度 0.5 时期望 2000，正好匹配一道 2000 分的题。"""
    taxonomy = Taxonomy()
    item = problem(1, ['math.number-theory.prime'], difficulty=2000)
    beginner = recommend([item], {'math.number-theory.prime': 0.0}, [], taxonomy)[0]
    matched = recommend([item], {'math.number-theory.prime': 0.5}, [], taxonomy)[0]
    advanced = recommend([item], {'math.number-theory.prime': 1.0}, [], taxonomy)[0]
    assert matched['score_breakdown']['difficulty_fit'] == 1.0
    assert beginner['score_breakdown']['difficulty_fit'] == 0.0
    assert advanced['score_breakdown']['difficulty_fit'] == 0.0
    assert beginner['score_breakdown']['weakness'] > advanced['score_breakdown']['weakness']
