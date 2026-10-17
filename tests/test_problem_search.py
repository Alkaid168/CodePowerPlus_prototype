"""题库检索使用当前分析，在分页前筛选与排序，数据全部来自隔离夹具。"""
from tests.test_api_problems import manual_payload


def test_search_title_first_then_body_or_current_chinese_tag(client, make_problem):
    title, _ = make_problem(title='前缀和练习', description='数组查询')
    body, _ = make_problem(title='区间查询', description='请使用前缀和')
    tagged, _ = make_problem(title='批量统计', description='数组统计')
    result = client.get('/api/problems', params={'q': ' 前缀和 ', 'limit': 2}).json()
    assert result['total'] == 3
    assert [p['id'] for p in result['items']] == [title['id'], tagged['id']]
    assert client.get('/api/problems', params={'q': '前缀和', 'limit': 2, 'offset': 2}).json()['items'][0]['id'] == body['id']


def test_filters_compose_and_include_descendant_and_secondary_tags(client, make_problem):
    low, _ = make_problem(primary=('ds.fenwick',), secondary=('basic.prefix-sum',), difficulty=1200)
    make_problem(primary=('ds.segment-tree.basic',), difficulty=2000)
    make_problem(primary=('string.kmp',), difficulty=1200)
    client.post('/api/problems', json={'title': '尚未分析', 'description': '数组'})
    result = client.get('/api/problems', params={'knowledge_id': 'ds', 'difficulty_min': 1100, 'difficulty_max': 1300}).json()
    assert result['total'] == 1 and result['items'][0]['id'] == low['id']
    assert client.get('/api/problems', params={'knowledge_id': 'basic.prefix-sum'}).json()['items'][0]['id'] == low['id']
    assert client.get('/api/problems', params={'q': '', 'limit': 1}).json()['total'] == 4


def test_filters_use_latest_analysis_not_history(client, make_problem, version):
    problem, _ = make_problem(primary=('ds.fenwick',), difficulty=1200)
    payload = manual_payload(version, difficulty=2000)
    assert client.post(f"/api/problems/{problem['id']}/analyses", json=payload).status_code == 201
    assert client.get('/api/problems', params={'q': '树状数组'}).json()['total'] == 0
    assert client.get('/api/problems', params={'knowledge_id': 'ds'}).json()['total'] == 0
    assert client.get('/api/problems', params={'difficulty_max': 1300}).json()['total'] == 0
    assert client.get('/api/problems', params={'knowledge_id': 'basic.prefix-sum', 'difficulty_min': 2000}).json()['total'] == 1


def test_search_is_literal_and_filters_are_validated(client, make_problem):
    make_problem(title='100% 检查', description='下划线 _')
    make_problem(title='普通题', description='正常内容')
    assert client.get('/api/problems', params={'q': '%'}).json()['total'] == 1
    assert client.get('/api/problems', params={'q': '_'}).json()['total'] == 1
    for params in ({'knowledge_id': 'invented'}, {'difficulty_min': 2000, 'difficulty_max': 1000},
                   {'difficulty_min': 0}, {'limit': 201}, {'offset': -1}):
        assert client.get('/api/problems', params=params).status_code == 422


def test_pagination_has_stable_counts_and_no_duplicates(client, make_problem):
    ids = [make_problem(title=f'测试题 {i}')[0]['id'] for i in range(23)]
    pages = [client.get('/api/problems', params={'limit': 10, 'offset': n}).json() for n in (0, 10, 20)]
    assert [page['total'] for page in pages] == [23, 23, 23]
    assert [len(page['items']) for page in pages] == [10, 10, 3]
    assert [p['id'] for page in pages for p in page['items']] == ids[::-1]


def test_multiple_tags_require_every_group_before_pagination(client, make_problem):
    first, _ = make_problem(title='统计练习', primary=('ds.fenwick',), secondary=('basic.prefix-sum',), difficulty=1200)
    second, _ = make_problem(primary=('ds.segment-tree.basic',), secondary=('basic.prefix-sum',), difficulty=1200)
    make_problem(primary=('ds.fenwick',), difficulty=1200)
    make_problem(primary=('basic.prefix-sum',), difficulty=1200)
    make_problem(primary=('ds.fenwick',), secondary=('basic.prefix-sum',), difficulty=2000)
    params = {'knowledge_ids': 'ds,basic', 'difficulty_min': 1100, 'difficulty_max': 1300, 'limit': 1}
    result = client.get('/api/problems', params=params).json()
    assert result['total'] == 2 and result['items'][0]['id'] == second['id']
    result = client.get('/api/problems', params={**params, 'offset': 1}).json()
    assert result['total'] == 2 and result['items'][0]['id'] == first['id']
    result = client.get('/api/problems', params={**params, 'knowledge_ids': 'ds.fenwick,basic.prefix-sum'}).json()
    assert result['total'] == 1 and result['items'][0]['id'] == first['id']
    result = client.get('/api/problems', params={**params, 'q': '统计'}).json()
    assert result['total'] == 1 and result['items'][0]['id'] == first['id']


def test_multi_tags_validate_normalize_and_use_current_analysis(client, make_problem, version):
    problem, _ = make_problem(primary=('ds.fenwick',), secondary=('basic.prefix-sum',))
    params = {'knowledge_ids': ' ds.fenwick, ,basic.prefix-sum,ds.fenwick '}
    assert client.get('/api/problems', params=params).json()['total'] == 1
    assert client.get('/api/problems', params={**params, 'knowledge_id': 'string.kmp'}).json()['total'] == 0
    assert client.get('/api/problems', params={'knowledge_ids': 'ds,invented'}).status_code == 422
    assert client.get('/api/problems', params={'knowledge_ids': ' , '}).json()['total'] == 1
    payload = manual_payload(version)
    assert client.post(f"/api/problems/{problem['id']}/analyses", json=payload).status_code == 201
    assert client.get('/api/problems', params=params).json()['total'] == 0
