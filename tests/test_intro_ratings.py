"""新生100–700评分门槛与原算法评分兼容，全部使用隔离库。"""
import pytest
from pydantic import ValidationError

from app.errors import InvalidInput
from app.schemas import AnalysisPayload
from app.services.analysis import PROMPT_VERSION, SYSTEM_PROMPT, validate
from app.services.difficulty import BANDS, band_name, is_valid_rating


NAMES = ['输出入门', '变量与输入输出', '基本运算', '条件分支', '循环与数组', '字符与字符串', '基础综合']


def payload(version, rating=300, node='syntax.expressions'):
    return AnalysisPayload(difficulty=rating, confidence=.9, difficulty_reason='完成加法运算',
                           primary_knowledge_ids=[node], secondary_knowledge_ids=[],
                           evidence={node: '对输入的两个整数做加法'}, knowledge_confidence={node: .9},
                           taxonomy_version=version)


def test_intro_bands_and_old_algorithm_bands():
    for index, name in enumerate(NAMES, 1):
        assert is_valid_rating(index * 100)
        assert band_name(index * 100) == name
    assert [row[:3] for row in BANDS if row[0] >= 800] == [
        (800, 1000, '入门'), (1100, 1300, '基础'), (1400, 1600, '进阶'),
        (1700, 1900, '提高'), (2000, 2200, '区域赛铜牌'), (2300, 2500, '区域赛银牌'),
        (2600, 2900, '区域赛金牌'), (3000, 3500, '国际赛')]
    for value in (0, 50, 750, 3600):
        with pytest.raises(ValidationError):
            AnalysisPayload(difficulty=value, confidence=.9)


def test_low_ratings_cannot_include_harder_or_algorithm_tags(container, version):
    validate(payload(version), container.taxonomy, model_name='manual', require_current_version=True)
    for rating, node in ((100, 'syntax.expressions'), (500, 'syntax.characters-strings'), (700, 'basic.simulate'), (700, 'graph.shortest-path')):
        with pytest.raises(InvalidInput):
            validate(payload(version, rating, node), container.taxonomy, model_name='manual', require_current_version=True)
    validate(payload(version, 700, 'syntax.basic-integration.prime-trial'), container.taxonomy, model_name='test-model')


def test_intro_rating_api_and_filter(client, version):
    problem = client.post('/api/problems', json={'title': 'A+B', 'description': '输入两个整数，输出它们的和。'}).json()
    body = payload(version).model_dump()
    saved = client.post(f'/api/problems/{problem["id"]}/analyses', json=body)
    assert saved.status_code == 201, saved.text
    assert saved.json()['analysis']['difficulty_band'] == '基本运算'
    result = client.get('/api/problems', params={'difficulty_min': 100, 'difficulty_max': 700}).json()
    assert result['total'] == 1
    assert client.get('/api/knowledge/node/syntax.expressions').json()['intro_rating'] == 300


def test_new_prompt_has_explicit_ladder_and_no_legacy_floor():
    assert PROMPT_VERSION == 'problem-analysis-v8'
    assert 'A+B' in SYSTEM_PROMPT and '300' in SYSTEM_PROMPT and '质数' in SYSTEM_PROMPT
    assert '最低 800，没有更低档位' not in SYSTEM_PROMPT


@pytest.mark.parametrize('role', ['primary', 'secondary'])
def test_algorithm_ratings_reject_all_syntax_roles(container, version, role):
    value = payload(version, 1200, 'dp.misc')
    syntax_id = 'syntax.loops-arrays.array-traversal'
    ids = ['dp.misc', syntax_id]
    value = value.model_copy(update={
        'primary_knowledge_ids': ids if role == 'primary' else ['dp.misc'],
        'secondary_knowledge_ids': [] if role == 'primary' else [syntax_id],
        'evidence': {node: '实际解法依据' for node in ids},
        'knowledge_confidence': {node: .8 for node in ids}})
    with pytest.raises(InvalidInput, match='语法'):
        validate(value, container.taxonomy, model_name='test-model')
    validate(payload(version, 800, 'dp.misc'), container.taxonomy, model_name='test-model')
