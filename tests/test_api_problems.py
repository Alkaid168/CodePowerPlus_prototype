"""题目接口：录入（含 OJ 编号）、Markdown 题面、来源链接、模型分析与手工标注。"""
import pytest

from app.db import FIRST_PROBLEM_ID
from app.errors import InvalidInput

STATEMENT = """## 区间求和

给定数组 $a_1,\\dots,a_n$，回答 $q$ 次询问。

$$\\sum_{i=l}^{r} a_i$$

- 约束：$1 \\le n, q \\le 2 \\times 10^5$
"""


def manual_payload(version, **overrides):
    base = {
        'difficulty': 1200,
        'difficulty_reason': '前缀和是唯一主线，属于基础档',
        'confidence': 0.8,
        'primary_knowledge_ids': ['basic.prefix-sum'],
        'secondary_knowledge_ids': [],
        'evidence': {'basic.prefix-sum': '需要快速回答区间和'},
        'knowledge_confidence': {'basic.prefix-sum': 0.8},
        'taxonomy_version': version,
    }
    return base | overrides


def create_problem(client, title='两数之和', description='给定数组。', **extra):
    response = client.post('/api/problems', json={'title': title, 'description': description} | extra)
    assert response.status_code == 201, response.text
    return response.json()


def test_first_problem_gets_number_1000_and_statement_is_stored_verbatim(client):
    problem = create_problem(client, title='区间求和', description=STATEMENT)
    assert problem['id'] == FIRST_PROBLEM_ID
    assert problem['analysis'] is None and problem['analysis_status'] is None
    assert problem['knowledge_ids'] == [] and problem['difficulty'] is None
    assert problem['difficulty_band'] == '' and problem['source_url'] == ''

    second = create_problem(client, title='下一题')
    assert second['id'] == FIRST_PROBLEM_ID + 1

    detail = client.get(f"/api/problems/{problem['id']}").json()
    # Markdown 与 LaTeX 原样保存，只去掉整段首尾空白，不做任何转换。
    assert detail['description'] == STATEMENT.rstrip('\n')
    assert '$$\\sum_{i=l}^{r} a_i$$' in detail['description']
    assert detail['title'] == '区间求和'

    listing = client.get('/api/problems').json()
    assert listing['total'] == 2 and listing['items'][-1]['id'] == FIRST_PROBLEM_ID
    assert client.get('/api/problems', params={'q': '区间'}).json()['total'] == 1


def test_source_is_optional_but_must_be_a_link(client):
    linked = create_problem(client, source_url='https://codeforces.com/problemset/problem/1/A')
    assert linked['source_url'] == 'https://codeforces.com/problemset/problem/1/A'

    without = create_problem(client, title='无来源')
    assert without['source_url'] == ''

    for bad in ('codeforces.com/1/A', 'ftp://example.com/1', '   '):
        response = client.post('/api/problems', json={'title': 't', 'description': 'd', 'source_url': bad})
        # 空字符串等价于没有来源，其余非法写法被拒绝。
        assert response.status_code == (201 if not bad.strip() else 422), (bad, response.text)


def test_missing_problem_is_404(client):
    assert client.get('/api/problems/9999').status_code == 404
    assert client.get('/api/problems/9999/analyses').status_code == 404
    assert client.post('/api/problems/9999/analyze').status_code == 404
    assert client.post('/api/problems/9999/analyses', json=manual_payload('x')).status_code == 404


def test_manual_analysis_revisions_and_history(client, version):
    problem = create_problem(client)
    first = client.post(f"/api/problems/{problem['id']}/analyses", json=manual_payload(version))
    assert first.status_code == 201, first.text
    first_analysis = first.json()['analysis']
    assert first_analysis['review_status'] == 'pending' and first_analysis['origin'] == 'manual'
    assert first_analysis['tags'] == ['前缀和']
    assert first_analysis['difficulty'] == 1200 and first_analysis['difficulty_band'] == '基础'

    second = client.post(f"/api/problems/{problem['id']}/analyses",
                         json=manual_payload(version, difficulty=2000,
                                             primary_knowledge_ids=['basic.binary'],
                                             evidence={'basic.binary': '需要在有序序列上二分'},
                                             knowledge_confidence={'basic.binary': 0.8}))
    assert second.status_code == 201
    second_analysis = second.json()['analysis']
    assert second_analysis['analysis_id'] > first_analysis['analysis_id']
    assert second_analysis['difficulty_band'] == '区域赛铜牌'

    detail = client.get(f"/api/problems/{problem['id']}").json()
    assert detail['analysis']['analysis_id'] == second_analysis['analysis_id']
    assert detail['knowledge_ids'] == ['basic.binary']
    assert detail['difficulty'] == 2000 and detail['difficulty_band'] == '区域赛铜牌'

    history = client.get(f"/api/problems/{problem['id']}/analyses").json()['items']
    assert [item['analysis_id'] for item in history] == [second_analysis['analysis_id'],
                                                         first_analysis['analysis_id']]


@pytest.mark.parametrize('change', [
    {'primary_knowledge_ids': [], 'evidence': {}, 'knowledge_confidence': {}},
    {'primary_knowledge_ids': ['invented']},
    {'primary_knowledge_ids': ['math']},
    {'evidence': {}},
    {'knowledge_confidence': {}},
    {'taxonomy_version': '2020.01.1'},
    {'difficulty': 1650},
    {'difficulty': 400},
])
def test_invalid_manual_analysis_is_rejected(client, version, change):
    problem = create_problem(client)
    response = client.post(f"/api/problems/{problem['id']}/analyses", json=manual_payload(version, **change))
    assert response.status_code == 422, response.text
    assert response.json()['code'] in {'invalid_input', 'invalid_request'}
    assert client.get(f"/api/problems/{problem['id']}").json()['analysis'] is None


def test_manual_analysis_requires_version(client):
    problem = create_problem(client)
    response = client.post(f"/api/problems/{problem['id']}/analyses", json=manual_payload(''))
    assert response.status_code == 422


def test_model_analysis_is_persisted(client, monkeypatch, version):
    from app.api import problems as problems_api
    from app.schemas import AnalysisPayload

    def fake(description, taxonomy, settings):
        assert '统计模式串出现次数' in description
        return AnalysisPayload(difficulty=1800, difficulty_reason='需要 KMP 的前缀函数',
                               confidence=0.9, primary_knowledge_ids=['string.kmp'],
                               evidence={'string.kmp': '需要 KMP'}, knowledge_confidence={'string.kmp': 0.9},
                               taxonomy_version=taxonomy.version, model_name=settings.model)

    monkeypatch.setattr(problems_api, 'analyze_with_model', fake)
    problem = create_problem(client, title='模式匹配', description='统计模式串出现次数')
    response = client.post(f"/api/problems/{problem['id']}/analyze")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body['problem']['id'] == problem['id']
    assert body['analysis']['origin'] == 'model' and body['analysis']['review_status'] == 'pending'
    assert body['analysis']['model_name'] and body['analysis']['difficulty'] == 1800


def test_model_failure_keeps_the_problem_so_it_can_be_retried(client, monkeypatch):
    """模型不可用时题目仍然存在，用户不会丢掉刚录入的题面。"""
    from app.api import problems as problems_api
    from app.errors import ModelUnavailable

    def boom(*args, **kwargs):
        raise ModelUnavailable('尚未配置模型密钥')

    monkeypatch.setattr(problems_api, 'analyze_with_model', boom)
    problem = create_problem(client, title='待重试', description=STATEMENT)
    response = client.post(f"/api/problems/{problem['id']}/analyze")
    assert response.status_code == 503
    assert response.json()['code'] == 'model_unavailable'

    detail = client.get(f"/api/problems/{problem['id']}").json()
    assert detail['analysis'] is None
    assert detail['description'] == STATEMENT.rstrip('\n')


def test_model_invalid_output_is_rejected(client, monkeypatch):
    from app.api import problems as problems_api

    def boom(*args, **kwargs):
        raise InvalidInput('模型连续返回不符合知识标注规范的内容')

    monkeypatch.setattr(problems_api, 'analyze_with_model', boom)
    problem = create_problem(client)
    response = client.post(f"/api/problems/{problem['id']}/analyze")
    assert response.status_code == 422
    assert response.json()['code'] == 'invalid_input'
