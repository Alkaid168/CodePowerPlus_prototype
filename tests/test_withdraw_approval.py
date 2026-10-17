"""负责人撤销误通过：只追加审计，旧分析和旧审核不能改写。"""
import pytest

from app.errors import Conflict, InvalidInput
from app.schemas import AnalysisPayload
from app.services.review import withdraw_approval


def correction(version, node='dp.misc'):
    return AnalysisPayload(difficulty=1200, difficulty_reason='负责人指定基础二维路径计数DP锚点', confidence=.9,
                           primary_knowledge_ids=[node], evidence={node: '定义路径计数状态与转移'},
                           knowledge_confidence={node: .9}, taxonomy_version=version)


def withdraw(container, problem, analysis, value):
    return withdraw_approval(db=container.db, problems=container.problems, analyses=container.analyses,
                             reviews=container.reviews, taxonomy=container.taxonomy, problem_id=problem['id'],
                             expected_analysis_id=analysis['analysis_id'], correction=value,
                             reviewer='project-owner-via-assistant', comment='负责人要求撤销误通过')


def test_withdraw_and_correct_preserves_history(container, approved_problem, version):
    problem, old = approved_problem()
    original_rows = [tuple(row) for row in container.db.query('SELECT * FROM analysis_reviews')]
    result = withdraw(container, problem, old, correction(version))
    assert result['review_status'] == 'rejected' and result['difficulty'] == 1200
    assert result['primary_knowledge_ids'] == ['dp.misc'] and result['origin'] == 'manual'
    assert container.analyses.get(old['analysis_id'])['review_status'] == 'rejected'
    assert original_rows[0] == tuple(container.db.query('SELECT * FROM analysis_reviews ORDER BY id')[0])
    assert container.reviews.count() == 3 and container.analyses.count() == 2
    with pytest.raises(Conflict):
        withdraw(container, problem, old, correction(version))
    assert container.reviews.count() == 3


def test_invalid_correction_cannot_withdraw_before_validation(container, approved_problem, version):
    problem, old = approved_problem()
    with pytest.raises(InvalidInput):
        withdraw(container, problem, old, correction(version, 'syntax.loops-arrays.array-traversal'))
    assert container.analyses.latest(problem['id'])['review_status'] == 'approved'
    assert container.reviews.count() == 1 and container.analyses.count() == 1
