"""v8先验证解法/标签，再独立定级；测试绝不调用真实模型。"""
import json
from dataclasses import replace
from types import SimpleNamespace

import pytest

from app.errors import InvalidInput
from app.services.analysis import analyze_with_model
from app.services.analysis_v8 import SolutionPlan, check_plan


def plan():
    return {'title': '区间操作', 'kind': 'algorithm',
            'solution_idea': '差分上两次单点更新，用树状数组计算动态前缀和，单次O(log n)。',
            'methods': [{'name': '树状数组维护差分', 'knowledge_ids': ['basic.difference', 'ds.fenwick'],
                         'time_complexity': 'O((n+q) log n)', 'space_complexity': 'O(n)'}],
            'primary_knowledge_ids': ['basic.difference', 'ds.fenwick'], 'secondary_knowledge_ids': [],
            'evidence': {'basic.difference': '区间加转为边界点更新', 'ds.fenwick': '动态前缀和查询'},
            'knowledge_confidence': {'basic.difference': .9, 'ds.fenwick': .9}, 'confidence': .9}


def grade(**changes):
    return {'difficulty': 1400, 'difficulty_reason': '需要差分转化和动态前缀和维护', 'confidence': .85,
            'rubric': {'knowledge': '动态数据结构', 'modelling': '区间转差分', 'proof': '前缀不变量',
                       'implementation': '边界更新与查询'}, 'consistency_issues': [], **changes}


def fake_client(monkeypatch, outputs):
    import openai
    calls = []
    class Fake:
        def __init__(self, **kwargs): self.chat = SimpleNamespace(completions=self)
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def create(self, **kwargs):
            calls.append(json.loads(json.dumps(kwargs)))
            return SimpleNamespace(model='provider-actual-model', id='response-id',
                usage=SimpleNamespace(model_dump=lambda: {'prompt_tokens': 123, 'completion_tokens': 45}),
                choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(outputs.pop(0), ensure_ascii=False)))])
    monkeypatch.setattr(openai, 'OpenAI', Fake)
    return calls


def test_plan_rejects_method_tag_omissions(container):
    bad = plan(); bad['primary_knowledge_ids'] = ['basic.difference']
    bad['evidence'].pop('ds.fenwick'); bad['knowledge_confidence'].pop('ds.fenwick')
    with pytest.raises(InvalidInput, match='方法'):
        check_plan(SolutionPlan.model_validate(bad), container.taxonomy)


def test_two_calls_keep_rating_out_of_solution_stage_and_capture_provenance(container, monkeypatch):
    calls = fake_client(monkeypatch, [plan(), grade()])
    result = analyze_with_model('维护区间加法与单点查询。', container.taxonomy,
                                replace(container.settings, api_key='test-not-real'))
    assert len(calls) == 2 and 'difficulty' not in json.loads(calls[1]['messages'][1]['content'])['solution']
    assert result.primary_knowledge_ids == ['basic.difference', 'ds.fenwick'] and result.difficulty == 1400
    assert result.prompt_version == 'problem-analysis-v8'
    assert [s['stage'] for s in result.assessment_meta['calls']] == ['solve', 'grade']
    assert all(s['response_model'] == 'provider-actual-model' for s in result.assessment_meta['calls'])
    assert result.assessment_meta['calls'][0]['usage']['prompt_tokens'] == 123


def test_invalid_rating_retries_with_own_response_not_silent_score_patch(container, monkeypatch):
    calls = fake_client(monkeypatch, [plan(), grade(difficulty=700), grade(difficulty=1500)])
    result = analyze_with_model('算法题', container.taxonomy, replace(container.settings, api_key='test-not-real'))
    assert result.difficulty == 1500 and len(calls) == 3
    assert calls[-1]['messages'][-2]['role'] == 'assistant'
    assert json.loads(calls[-1]['messages'][-2]['content'])['difficulty'] == 700
    assert result.assessment_meta['calls'][1]['valid'] is False


def test_grader_consistency_issue_rebuilds_solution(container, monkeypatch):
    calls = fake_client(monkeypatch, [plan(), grade(consistency_issues=['未检查更新边界']), plan(), grade()])
    result = analyze_with_model('算法题', container.taxonomy, replace(container.settings, api_key='test-not-real'))
    assert len(calls) == 4 and result.difficulty == 1400
    assert [c['stage'] for c in result.assessment_meta['calls']] == ['solve', 'grade', 'solve', 'grade']


def test_plan_cannot_mix_syntax_and_algorithm(container):
    bad = plan(); bad['kind'] = 'syntax'
    with pytest.raises(InvalidInput):
        check_plan(SolutionPlan.model_validate(bad), container.taxonomy)
