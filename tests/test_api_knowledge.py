"""知识树接口。"""
import pytest



def test_tree_reports_version_total_and_children(client):
    data = client.get('/api/knowledge/tree').json()
    assert data['version'] and data['total'] >= 330
    assert [node['name'] for node in data['tree']] == [
        '语法基础', '算法基础', '搜索', '动态规划', '字符串', '数学', '数据结构', '图论', '计算几何', '杂项']
    assert data['total'] == 377
    assert set(data['tree'][0]) <= {
        'id', 'name', 'level', 'parent_id', 'summary', 'children', 'intro_rating',
        'difficulty_weight', 'importance_weight',
    }
    assert data['tree'][0]['summary'] == ''          # L1 领域是分支，没有介绍


def test_search_supports_query_and_level_filter(client):
    data = client.get('/api/knowledge/search', params={'q': '快速幂'}).json()
    assert [item['id'] for item in data['items']] == ['math.binary-exponentiation']
    only_l3 = client.get('/api/knowledge/search', params={'q': '数论', 'level': 'L3'}).json()
    assert only_l3['items'] and all(item['level'] == 3 for item in only_l3['items'])
    assert client.get('/api/knowledge/search', params={'level': 'L9'}).status_code == 422
    assert client.get('/api/knowledge/search').json()['total'] >= 330


def test_detail_returns_path_and_children(client):
    node = client.get('/api/knowledge/math.number-theory').json()
    assert node['name'] == '数论'
    assert [ancestor['id'] for ancestor in node['ancestors']] == ['math']
    assert any(child['id'] == 'math.number-theory.prime' for child in node['children'])


def test_leaf_knowledge_point_has_summary_and_no_children(client):
    node = client.get('/api/knowledge/math.binary-exponentiation').json()
    assert node['level'] == 2 and node['children'] == []
    assert 50 <= len(node['summary']) <= 200


def test_branch_node_has_no_summary_but_children_do(client):
    branch = client.get('/api/knowledge/math.number-theory').json()
    assert branch['summary'] == ''
    assert all(len(child['summary']) >= 50 for child in branch['children'])


def test_unknown_knowledge_returns_404(client):
    response = client.get('/api/knowledge/not.exists')
    assert response.status_code == 404
    assert response.json()['code'] == 'not_found'


def test_reserved_search_node_has_dedicated_detail_route(client):
    """节点 ID search 不能与搜索接口路由冲突。"""
    node = client.get('/api/knowledge/node/search').json()
    assert node['id'] == 'search'
    assert node['name'] == '搜索'
    assert node['ancestors'] == []
    assert isinstance(node['children'], list)


@pytest.mark.parametrize(
    ('query', 'expected'),
    [
        ('DFS', {'search.dfs', 'graph.dfs'}),
        ('dfs', {'search.dfs', 'graph.dfs'}),
        ('KMP', {'string.kmp'}),
        ('kmp', {'string.kmp'}),
        ('stack', {'ds.stack'}),
        ('shortest path', {'graph.shortest-path'}),
        ('shortest-path', {'graph.shortest-path'}),
        ('binary exponentiation', {'math.binary-exponentiation'}),
        ('快速幂', {'math.binary-exponentiation'}),
    ],
)
def test_search_supports_chinese_english_and_is_case_insensitive(client, query, expected):
    data = client.get('/api/knowledge/search', params={'q': query}).json()
    assert expected <= {item['id'] for item in data['items']}
