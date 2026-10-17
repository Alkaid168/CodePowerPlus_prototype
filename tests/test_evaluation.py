import json
import subprocess
import sys
from pathlib import Path

import pytest

from app.evaluation import classification_metrics, difficulty_mae, recommendation_metrics, evaluate_predictions, mastery_from_history


def test_classification_metrics_hand_checked():
    # Across two problems: TP=2 FP=1 FN=2 => P=2/3 R=1/2 F1=4/7.
    m = classification_metrics([['a', 'b'], ['b', 'c']], [['a', 'x'], ['b']])
    assert m['micro']['precision'] == pytest.approx(2/3)
    assert m['micro']['recall'] == 0.5
    assert m['micro']['f1'] == pytest.approx(4/7)
    with pytest.raises(ValueError):
        classification_metrics([['a']], [])


def test_difficulty_mae_hand_checked_and_rejects_missing_predictions():
    # 项目评分为 100–3500，误差直接用分数差表示。
    assert difficulty_mae([800, 1600], [1200, 1200]) == 400.0
    assert difficulty_mae([1200], [1200]) == 0.0
    with pytest.raises(ValueError):
        difficulty_mae([1200], None)
    with pytest.raises(ValueError):
        difficulty_mae([800, 1200], [1200])
    with pytest.raises(ValueError):
        difficulty_mae([1250], [1200])


def test_recommendation_metrics_hand_checked():
    # One of two queries hits at rank 2. Three unique shown / four eligible.
    m = recommendation_metrics(
        [['p2', 'p1'], ['p3']], [{'p1'}, {'p4'}],
        candidate_ids={'p1', 'p2', 'p3', 'p4'}, k=2,
    )
    assert m['hit_at_k'] == 0.5
    assert m['mrr'] == 0.25
    assert m['coverage'] == 0.75
    assert m['recommendation_count'] == 3


def test_recommendation_metrics_rejects_invalid_inputs():
    with pytest.raises(ValueError):
        recommendation_metrics([['x']], [], candidate_ids={'x'}, k=2)
    with pytest.raises(ValueError):
        recommendation_metrics([['x']], [{'x'}], candidate_ids={'x'}, k=0)
    with pytest.raises(ValueError):
        recommendation_metrics([['x', 'x']], [{'x'}], candidate_ids={'x'}, k=2)


def test_predictions_join_by_id_and_do_not_reuse_gold():
    problems = [
        {'id': 1, 'gold': {'primary_knowledge_ids': ['a'], 'secondary_knowledge_ids': [], 'difficulty': 800}},
        {'id': 2, 'gold': {'primary_knowledge_ids': ['b'], 'secondary_knowledge_ids': [], 'difficulty': 1600}},
    ]
    missing = evaluate_predictions(problems, None, 'v1')
    assert missing['status'] == 'not_evaluated'
    assert missing['classification'] is None
    assert missing['difficulty_mae'] is None
    predictions = {'taxonomy_version': 'v1', 'model_name': 'external-test', 'prompt_version': 'test-v1', 'provenance': 'test_fixture', 'predictions': [
        {'problem_id': 2, 'primary_knowledge_ids': ['b'], 'secondary_knowledge_ids': [], 'difficulty': 1200},
        {'problem_id': 1, 'primary_knowledge_ids': ['x'], 'secondary_knowledge_ids': [], 'difficulty': 1200},
    ]}
    result = evaluate_predictions(problems, predictions, 'v1')
    assert result['classification']['micro']['f1'] == 0.5
    assert result['difficulty_mae'] == 400
    predictions['taxonomy_version'] = 'wrong'
    with pytest.raises(ValueError):
        evaluate_predictions(problems, predictions, 'v1')


def test_history_latest_algorithm_verdict_ignores_ce():
    problems = [{'id': 1, 'gold': {'primary_knowledge_ids': ['a'], 'secondary_knowledge_ids': []}}]
    mastery, solved = mastery_from_history([
        {'problem_id': 1, 'verdict': 'WA'}, {'problem_id': 1, 'verdict': 'AC'},
        {'problem_id': 1, 'verdict': 'CE'},
    ], problems)
    # Latest non-CE AC evidence for one independent problem: (1+1)/(2+1)=2/3.
    assert mastery == {'a': 0.6667}
    assert solved == {1}


def test_cli_reproducible_reports_without_database(tmp_path):
    root = Path(__file__).resolve().parents[1]
    outputs = []
    for i in range(2):
        target = tmp_path / str(i)
        result = subprocess.run([sys.executable, str(root / 'scripts/evaluate.py'), '--output-dir', str(target), '--seed', '42', '--k', '3'], cwd=tmp_path, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        report = json.loads((target / 'report.json').read_text(encoding='utf-8'))
        assert (target / 'report.md').is_file()
        assert report['provenance'] == 'authored_fixture'
        assert report['sample_counts']['problems'] >= 12
        assert report['sample_counts']['learners'] >= 3
        assert report['analysis']['status'] == 'not_evaluated'
        assert set(report['recommendation']) == {'baseline', 'graph'}
        outputs.append(report)
    assert outputs[0] == outputs[1]



def test_mastery_counts_independent_problems_not_attempts():
    problems = [{'id': i, 'gold': {'primary_knowledge_ids': ['a'], 'secondary_knowledge_ids': []}} for i in [1, 2]]
    mastery, solved = mastery_from_history([
        {'problem_id': 1, 'verdict': 'WA'}, {'problem_id': 1, 'verdict': 'WA'},
        {'problem_id': 1, 'verdict': 'AC'}, {'problem_id': 2, 'verdict': 'TLE'},
    ], problems)
    # Two independent problems, exactly one final AC: (1+1)/(2+2) = 0.5.
    assert mastery == {'a': 0.5}
    assert solved == {1}
