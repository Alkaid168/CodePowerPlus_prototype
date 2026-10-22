"""知识图谱 API：全量输出、既有接口兼容和只读失败边界。"""
import json

import pytest


@pytest.fixture()
def graph_path(tmp_path, monkeypatch):
    from app import knowledge_graph
    path = tmp_path / 'graph.json'
    path.write_text(json.dumps({
        'version': '2026.10.1',
        'taxonomy_version': '2026.10.1',
        'provenance': 'agent-curated-prerequisites-v1; not teacher-reviewed',
        'edges': [{
            'source': 'ds.stack', 'target': 'search.dfs',
            'reason': '理解调用栈才能追踪递归搜索。',
            'references': ['https://oi-wiki.org/search/dfs/'],
        }],
    }), encoding='utf-8')
    monkeypatch.setattr(knowledge_graph, 'DEFAULT_PATH', path)
    return path


def test_graph_api_returns_all_337_leaves_without_query_truncation(client, container, graph_path):
    response = client.get('/api/knowledge/graph', params={'limit': 1, 'q': 'stack'})
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {'version', 'taxonomy_version', 'provenance', 'nodes', 'edges', 'domains'}
    assert body['taxonomy_version'] == container.taxonomy.version
    assert body['provenance'] == 'agent-curated-prerequisites-v1; not teacher-reviewed'
    assert len(body['nodes']) == 337
    assert {node['id'] for node in body['nodes']} == {
        node['id'] for node in container.taxonomy.leaves()
    }
    assert len(body['edges']) == 1
    assert len(body['domains']) == 10
    assert all(set(node) == {'id', 'name', 'summary', 'domain_id', 'domain_name',
                             'difficulty_weight', 'importance_weight'}
               for node in body['nodes'])


def test_graph_api_uses_application_taxonomy_not_a_new_default(client, container, graph_path):
    container.taxonomy.nodes['ds.stack']['name'] = '本应用的栈名称'
    body = client.get('/api/knowledge/graph').json()
    assert next(node for node in body['nodes'] if node['id'] == 'ds.stack')['name'] == '本应用的栈名称'


def test_graph_api_does_not_write_database_or_content(client, container, graph_path):
    before_changes = container.db.conn.total_changes
    before_file = graph_path.read_bytes()
    assert client.get('/api/knowledge/graph').status_code == 200
    assert client.get('/api/knowledge/graph').status_code == 200
    assert container.db.conn.total_changes == before_changes
    assert graph_path.read_bytes() == before_file
    for method in ('post', 'put', 'patch', 'delete'):
        assert client.request(method, '/api/knowledge/graph', json={}).status_code == 405


def test_bad_graph_returns_explicit_service_error_not_empty_success(client, graph_path):
    graph_path.write_text('{broken', encoding='utf-8')
    response = client.get('/api/knowledge/graph')
    assert response.status_code == 503
    assert response.json()['code'] == 'knowledge_graph_invalid'
    assert response.json()['detail']


def test_graph_route_does_not_shadow_tree_search_or_node_details(client, graph_path):
    assert client.get('/api/knowledge/graph').status_code == 200
    assert client.get('/api/knowledge/tree').json()['total'] == 377
    assert client.get('/api/knowledge/search', params={'q': 'stack'}).json()['items']
    assert client.get('/api/knowledge/node/ds.stack').json()['id'] == 'ds.stack'
    assert client.get('/api/knowledge/ds.stack').json()['id'] == 'ds.stack'


def test_graph_api_overrides_summary_without_modifying_knowledge_detail(client, container, graph_path):
    original = client.get('/api/knowledge/node/graph.2-sat').json()['summary']
    data = json.loads(graph_path.read_text(encoding='utf-8'))
    summary = '2-SAT 的每个子句至多含两个文字，可借助蕴含图与强连通分量判断是否存在满足所有子句的赋值。'
    data['node_overrides'] = {
        'graph.2-sat': {'summary': summary, 'references': ['https://oi-wiki.org/graph/2-sat/']},
    }
    graph_path.write_text(json.dumps(data), encoding='utf-8')
    response = client.get('/api/knowledge/graph')
    assert response.status_code == 200, response.text
    body = response.json()
    node = next(node for node in body['nodes'] if node['id'] == 'graph.2-sat')
    assert node['summary'] == summary
    assert set(node) == {'id', 'name', 'summary', 'domain_id', 'domain_name',
                         'difficulty_weight', 'importance_weight'}
    assert 'node_overrides' not in body
    assert container.taxonomy.get('graph.2-sat')['summary'] == original
    assert client.get('/api/knowledge/node/graph.2-sat').json()['summary'] == original
