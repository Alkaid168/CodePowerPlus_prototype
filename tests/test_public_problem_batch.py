"""公开题批次使用隔离数据库，参考标注不能冒充教师或官方评分。"""
from copy import deepcopy
import json
from pathlib import Path

import pytest

from app.public_problem_batch import evaluate_batch, import_batch, predict_batch, validate_items
from app.services.analysis import PROMPT_VERSION


def test_curated_formatting_does_not_break_batch_idempotency(container, version):
    from app.statement_formatting import apply_formatting
    folder = Path(__file__).resolve().parents[1] / 'data/evaluation/public40'
    item = json.loads((folder / 'luogu.json').read_text(encoding='utf-8'))['items'][0]
    patch = json.loads((folder / 'formatting/luogu.json').read_text(encoding='utf-8'))['items'][0]
    outputs = {item['source_url']: prediction(item, version)}
    imported = import_batch(container, [item], outputs)
    apply_formatting(container.db, [item], [patch])
    repeated = import_batch(container, [item], outputs)
    assert not repeated[0]['created']
    assert repeated[0]['analysis_id'] == imported[0]['analysis_id']
    assert container.problems.get(imported[0]['problem_id'])['description'] == patch['description']


def sample(platform='codeforces', number='4A', rating=800):
    source = f'https://codeforces.com/problemset/problem/4/{number[-1]}' if platform == 'codeforces' else 'https://www.luogu.com.cn/problem/P1001'
    reference = {'provenance': 'agent_reference_not_human', 'difficulty': 800,
                 'difficulty_reason': '直接模拟', 'confidence': 0.8,
                 'primary_knowledge_ids': ['basic.simulate'], 'secondary_knowledge_ids': [],
                 'evidence': {'basic.simulate': '按定义直接计算'},
                 'knowledge_confidence': {'basic.simulate': 0.8}, 'solution_idea': '直接计算。'}
    return {'source_id': number, 'source_platform': platform, 'source_url': source,
            'title': number, 'description': '## 题目描述\n输出两个整数的和。',
            'official_difficulty': {'rating': rating} if platform == 'codeforces' else {'label': '入门'},
            'reference': reference, 'source_checks': {'statement_verified': True, 'samples_verified': True}}


def prediction(item, version, difficulty=1000):
    return {**{key: value for key, value in item['reference'].items() if key != 'provenance'},
            'title': item['title'], 'difficulty': difficulty, 'taxonomy_version': version,
            'prompt_version': PROMPT_VERSION, 'model_name': 'test-model',
            'tags': ['模拟']}


def test_validate_source_reference_and_duplicates(container):
    item = sample()
    validate_items([item], container.taxonomy)
    with pytest.raises(ValueError, match='duplicate'):
        validate_items([item, deepcopy(item)], container.taxonomy)
    bad = deepcopy(item)
    bad['source_url'] = 'https://unverified.example/problem'
    with pytest.raises(ValueError, match='source'):
        validate_items([bad], container.taxonomy)
    bad = deepcopy(item)
    bad['reference']['provenance'] = 'human_gold'
    with pytest.raises(ValueError, match='reference'):
        validate_items([bad], container.taxonomy)
    bad = deepcopy(item)
    bad['source_checks']['samples_verified'] = False
    with pytest.raises(ValueError, match='verified'):
        validate_items([bad], container.taxonomy)


def test_metrics_separate_official_cf_from_estimated_luogu_and_failures(version):
    cf, luogu = sample(), sample('luogu', 'P1001')
    predictions = {cf['source_url']: prediction(cf, version, 1000), luogu['source_url']: prediction(luogu, version, 1200)}
    result = evaluate_batch([cf, luogu], predictions)
    assert result['completed'] == 2
    assert result['platforms']['codeforces']['official_rating']['mae'] == 200
    assert result['platforms']['luogu']['official_rating']['samples'] == 0
    assert result['platforms']['luogu']['estimated_reference_rating']['mae'] == 400
    assert result['label_reference_provenance'] == 'agent_reference_not_human'
    assert result['classification']['micro']['f1'] == 1
    missing = evaluate_batch([cf, luogu], {cf['source_url']: predictions[cf['source_url']]})
    assert missing['completed'] == 1 and missing['missing'] == [luogu['source_url']]
    assert missing['platforms']['luogu']['classification']['samples'] == 0


def test_import_is_pending_model_snapshot_and_idempotent(container, version):
    item = sample()
    predictions = {item['source_url']: prediction(item, version)}
    first = import_batch(container, [item], predictions)
    assert first[0]['created'] is True
    current = container.analyses.latest(first[0]['problem_id'])
    assert current['origin'] == 'model' and current['review_status'] == 'pending'
    assert current['input_snapshot']['description'] == item['description']
    second = import_batch(container, [item], predictions)
    assert second[0]['created'] is False
    assert container.problems.count() == container.analyses.count() == 1
    assert container.reviews.list_for_problem(first[0]['problem_id']) == []


def test_missing_predictions_or_conflicting_sources_never_partially_import(container, version):
    cf, luogu = sample(), sample('luogu', 'P1001')
    with pytest.raises(ValueError, match='missing'):
        import_batch(container, [cf, luogu], {cf['source_url']: prediction(cf, version)})
    assert container.problems.count() == 0
    old = container.problems.create(title='原题', description='原正文', source_url=luogu['source_url'])
    with pytest.raises(ValueError, match='conflict'):
        import_batch(container, [cf, luogu], {x['source_url']: prediction(x, version) for x in [cf, luogu]})
    assert container.problems.count() == 1 and container.analyses.count() == 0
    assert container.problems.get(old['id'])['description'] == '原正文'


def test_prediction_input_blind_checkpoint_and_changed_statement(container):
    item = sample()
    checkpoint, calls, saves = {}, [], []
    def analyzer(description, taxonomy, settings):
        calls.append(description)
        return AnalysisPayload.model_validate(prediction(item, taxonomy.version))
    from app.schemas import AnalysisPayload
    first = predict_batch([item], container.taxonomy, container.settings, checkpoint,
                          lambda state: saves.append(deepcopy(state)), analyzer=analyzer)
    assert calls == [item['description']]
    assert first[item['source_url']]['difficulty'] == 1000
    assert saves and checkpoint['items'][item['source_url']]['status'] == 'complete'
    predict_batch([item], container.taxonomy, container.settings, checkpoint, lambda _: None, analyzer=analyzer)
    assert len(calls) == 1
    changed = deepcopy(item)
    changed['description'] += '\n输入范围改变。'
    predict_batch([changed], container.taxonomy, container.settings, checkpoint, lambda _: None, analyzer=analyzer)
    assert len(calls) == 2


def test_prediction_failure_is_checkpointed_without_substituting_reference(container):
    item, checkpoint = sample(), {}
    def unavailable(*args):
        raise RuntimeError('test unavailable')
    result = predict_batch([item], container.taxonomy, container.settings, checkpoint, lambda _: None, analyzer=unavailable)
    assert result == {}
    assert checkpoint['items'][item['source_url']]['status'] == 'failed'
    assert 'analysis' not in checkpoint['items'][item['source_url']]


def test_read_only_checkpoint_rejects_changed_input_and_invalid_provenance(container):
    from app.public_problem_batch import read_predictions
    from app.schemas import AnalysisPayload
    item, checkpoint = sample(), {}
    predict_batch([item], container.taxonomy, container.settings, checkpoint, lambda _: None,
                  analyzer=lambda *args: AnalysisPayload.model_validate(prediction(item, container.taxonomy.version)))
    assert len(read_predictions([item], container.taxonomy, container.settings, checkpoint)) == 1
    changed = deepcopy(item)
    changed['description'] += '\n新版题面'
    assert read_predictions([changed], container.taxonomy, container.settings, checkpoint) == {}
    broken = deepcopy(checkpoint)
    broken['items'][item['source_url']]['analysis']['primary_knowledge_ids'] = ['invented']
    assert read_predictions([item], container.taxonomy, container.settings, broken) == {}
    for key, value in [('model_name', 'manual'), ('prompt_version', 'problem-analysis-v4'), ('taxonomy_version', 'old')]:
        broken = deepcopy(checkpoint)
        broken['items'][item['source_url']]['analysis'][key] = value
        assert read_predictions([item], container.taxonomy, container.settings, broken) == {}
    for value in (None, []):
        broken = deepcopy(checkpoint)
        broken['items'][item['source_url']]['analysis'] = value
        assert read_predictions([item], container.taxonomy, container.settings, broken) == {}
        broken['items'][item['source_url']] = value
        assert read_predictions([item], container.taxonomy, container.settings, broken) == {}
