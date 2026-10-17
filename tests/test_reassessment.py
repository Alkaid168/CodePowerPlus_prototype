"""重评只追加；题面/人工分析并发变更与无效断点不能悄悄覆盖。"""
import copy

import pytest

from app.reassessment import apply_results, freeze, predict
from app.schemas import AnalysisPayload


def prediction(version):
    node = 'syntax.expressions'
    return AnalysisPayload(title='A+B', difficulty=300, difficulty_reason='加法', confidence=.9,
                           primary_knowledge_ids=[node], evidence={node: '求两数和'},
                           knowledge_confidence={node: .9}, taxonomy_version=version)


def test_checkpoint_resume_and_reference_inputs(container, make_problem, version):
    problem, _ = make_problem()
    manifest = freeze(container)
    checkpoint, calls, saves = {}, [], []
    def analyzer(description, taxonomy, settings, **references):
        calls.append((description, references))
        return prediction(version)
    first = predict(manifest, container.taxonomy, container.settings, checkpoint,
                    lambda state: saves.append(copy.deepcopy(state)), analyzer=analyzer)
    second = predict(manifest, container.taxonomy, container.settings, checkpoint, lambda _: None, analyzer=analyzer)
    assert first == second and len(calls) == len(saves) == 1
    assert calls[0] == (problem['description'], {'reference_solution': '', 'reference_code': ''})
    checkpoint['items'][str(problem['id'])]['analysis']['difficulty'] = 100
    predict(manifest, container.taxonomy, container.settings, checkpoint, lambda _: None, analyzer=analyzer)
    assert len(calls) == 2  # 未通过门槛校验的缓存不能复用。


def test_atomic_append_preserves_history_and_is_idempotent(container, make_problem, version):
    problem, old = make_problem()
    manifest = freeze(container)
    result = predict(manifest, container.taxonomy, container.settings, {}, lambda _: None,
                     analyzer=lambda *a, **kw: prediction(version))
    before = [tuple(row) for row in container.db.query('SELECT * FROM problem_analyses')]
    receipt = apply_results(container, manifest, result)
    assert container.analyses.count() == 2
    latest = container.analyses.latest(problem['id'])
    assert latest['difficulty'] == 300 and latest['review_status'] == 'pending'
    assert latest['origin'] == 'model'
    assert tuple(container.db.query('SELECT * FROM problem_analyses ORDER BY id')[0]) == before[0]
    assert apply_results(container, manifest, result) == receipt
    assert container.analyses.count() == 2 and container.reviews.count() == 0


@pytest.mark.parametrize('change', ['body', 'analysis', 'new_problem', 'missing_prediction'])
def test_conflict_or_incomplete_batch_never_partially_applies(container, make_problem, version, change):
    p1, _ = make_problem(title='one')
    p2, _ = make_problem(title='two')
    manifest = freeze(container)
    results = predict(manifest, container.taxonomy, container.settings, {}, lambda _: None,
                      analyzer=lambda *a, **kw: prediction(version))
    if change == 'body':
        fields = {key: p1[key] for key in ('title', 'description', 'source_url', 'reference_solution', 'reference_code')}
        fields['reference_code'] = 'changed'
        container.problems.update(p1['id'], fields, p1['revision'])
    elif change == 'analysis':
        container.analyses.add(p1['id'], prediction(version).model_dump(), origin='manual')
    elif change == 'new_problem':
        make_problem(title='three')
    else:
        results.pop(str(p2['id']))
    count = container.analyses.count()
    with pytest.raises(ValueError):
        apply_results(container, manifest, results)
    assert container.analyses.count() == count


def test_taxonomy_content_and_model_changes_invalidate_checkpoint(container, make_problem, version):
    make_problem()
    manifest = freeze(container)
    from dataclasses import replace
    with pytest.raises(ValueError):
        predict(manifest, container.taxonomy, replace(container.settings, model='different'), {}, lambda _: None)


def test_mid_insert_failure_rolls_back_whole_batch(container, make_problem, version, monkeypatch):
    make_problem(title='one')
    make_problem(title='two')
    manifest = freeze(container)
    results = predict(manifest, container.taxonomy, container.settings, {}, lambda _: None,
                      analyzer=lambda *a, **kw: prediction(version))
    add = container.analyses.add
    calls = 0
    def fail_second(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError('simulated disk write failure')
        return add(*args, **kwargs)
    monkeypatch.setattr(container.analyses, 'add', fail_second)
    with pytest.raises(RuntimeError):
        apply_results(container, manifest, results)
    assert container.analyses.count() == 2
    assert not container.db.query("SELECT value FROM schema_meta WHERE key LIKE 'reassessment:%'")


def test_unreviewed_scope_preserves_reviewed_problems(container, make_problem, approved_problem, version):
    approved, approved_analysis = approved_problem(title='已通过')
    rejected, rejected_analysis = make_problem(title='已驳回')
    container.reviews.add(rejected['id'], rejected_analysis['analysis_id'], rejected_analysis['analysis_id'],
                          'reject', 'tester', '已审核')
    pending, _ = make_problem(title='尚未审核')
    # 审过的题即使后来又出现待审版本，也不算从未审核的题，避免替换人工成果。
    container.analyses.add(rejected['id'], prediction(version).model_dump(), origin='manual')
    manifest = freeze(container, unreviewed_only=True)
    assert [item['id'] for item in manifest['items']] == [pending['id']]
    results = predict(manifest, container.taxonomy, container.settings, {}, lambda _: None,
                      analyzer=lambda *a, **kw: prediction(version))
    count = container.analyses.count()
    receipt = apply_results(container, manifest, results)
    assert container.analyses.count() == count + 1
    assert container.analyses.latest(approved['id'])['analysis_id'] == approved_analysis['analysis_id']
    assert container.reviews.count() == 2
    # 完成后用户批准新结果，重跑批次也不能重置其审核或重复追加。
    target = receipt[0]['analysis_id']
    container.reviews.add(pending['id'], target, target, 'approve', 'tester', '完成审核')
    assert apply_results(container, manifest, results) == receipt
    assert container.analyses.latest(pending['id'])['review_status'] == 'approved'


def test_new_review_during_scoped_run_refuses_apply(container, make_problem, version):
    problem, analysis = make_problem()
    manifest = freeze(container, unreviewed_only=True)
    results = predict(manifest, container.taxonomy, container.settings, {}, lambda _: None,
                      analyzer=lambda *a, **kw: prediction(version))
    container.reviews.add(problem['id'], analysis['analysis_id'], analysis['analysis_id'], 'approve', 'tester', '')
    with pytest.raises(ValueError):
        apply_results(container, manifest, results)
    assert container.analyses.count() == 1
