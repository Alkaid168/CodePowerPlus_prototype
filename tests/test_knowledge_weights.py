"""两种知识展示使用同一套权重；坏标注不能变成默认一星/红色。"""
import json

import pytest


def flatten(nodes):
    return [item for node in nodes for item in [node, *flatten(node.get('children', []))]]


def test_weights_are_complete_and_consistent_across_all_knowledge_endpoints(client, container):
    before = container.db.conn.total_changes
    tree = flatten(client.get('/api/knowledge/tree').json()['tree'])
    assert len(tree) == 377
    for node in tree:
        assert type(node.get('difficulty_weight')) is int, node['id']
        assert 1 <= node['difficulty_weight'] <= 8
        assert type(node.get('importance_weight')) is int
        assert 1 <= node['importance_weight'] <= 5
    by_id = {node['id']: node for node in tree}
    graph = client.get('/api/knowledge/graph').json()
    assert len(graph['nodes']) == 337 and len(graph['edges']) == 189
    for node in graph['nodes']:
        for key in ('difficulty_weight', 'importance_weight'):
            assert node[key] == by_id[node['id']][key]
    for node_id in ['ds.cat-tree', 'dp.plug', 'string.ac-automaton',
                    'syntax.variables-io.variables', 'graph.flow.max-flow']:
        detail = client.get(f'/api/knowledge/node/{node_id}').json()
        old_detail = client.get(f'/api/knowledge/{node_id}').json()
        search = client.get('/api/knowledge/search', params={'q': node_id}).json()['items']
        found = next(node for node in search if node['id'] == node_id)
        for key in ('difficulty_weight', 'importance_weight'):
            assert detail[key] == old_detail[key] == found[key] == by_id[node_id][key]
    assert container.db.conn.total_changes == before
    assert 'difficulty_weight' not in container.taxonomy.get('ds.cat-tree')


@pytest.fixture()
def weights_path(tmp_path, monkeypatch, container):
    from app import knowledge_weights
    path = tmp_path / 'weights.json'
    payload = {
        'version': '2026.10.1', 'taxonomy_version': container.taxonomy.version,
        'scope': 'competitive-programming-training',
        'nodes': {node_id: {'difficulty_weight': 2, 'importance_weight': 3}
                  for node_id in container.taxonomy.nodes},
    }
    path.write_text(json.dumps(payload), encoding='utf-8')
    monkeypatch.setattr(knowledge_weights, 'DEFAULT_PATH', path)
    return path


@pytest.mark.parametrize('value', [0, 9, 2.5, True, '3', None])
def test_bad_difficulty_fails_explicitly_without_fallback(client, weights_path, value):
    payload = json.loads(weights_path.read_text(encoding='utf-8'))
    payload['nodes']['ds.cat-tree']['difficulty_weight'] = value
    weights_path.write_text(json.dumps(payload), encoding='utf-8')
    response = client.get('/api/knowledge/node/ds.cat-tree')
    assert response.status_code == 503
    assert response.json()['code'] == 'knowledge_weights_invalid'


@pytest.mark.parametrize('change', ['missing', 'extra', 'importance', 'version', 'duplicate', 'unreadable'])
def test_bad_annotation_set_is_not_silently_accepted(client, weights_path, change):
    payload = json.loads(weights_path.read_text(encoding='utf-8'))
    if change == 'missing':
        del payload['nodes']['ds.cat-tree']
    elif change == 'extra':
        payload['nodes']['made-up'] = {'difficulty_weight': 2, 'importance_weight': 3}
    elif change == 'importance':
        payload['nodes']['ds.cat-tree']['importance_weight'] = 6
    elif change == 'version':
        payload['taxonomy_version'] = 'stale'
    raw = json.dumps(payload)
    if change == 'duplicate':
        raw = raw.replace('"difficulty_weight": 2', '"difficulty_weight": 2, "difficulty_weight": 3', 1)
    weights_path.write_text(raw, encoding='utf-8')
    if change == 'unreadable':
        weights_path.unlink()
    response = client.get('/api/knowledge/graph')
    assert response.status_code == 503
    assert response.json()['code'] == 'knowledge_weights_invalid'


def test_file_edits_are_revalidated_and_do_not_mutate_prior_results(client, weights_path):
    first = client.get('/api/knowledge/node/ds.cat-tree').json()
    assert first['difficulty_weight'] == 2
    payload = json.loads(weights_path.read_text(encoding='utf-8'))
    payload['nodes']['ds.cat-tree']['difficulty_weight'] = 7
    weights_path.write_text(json.dumps(payload), encoding='utf-8')
    assert client.get('/api/knowledge/node/ds.cat-tree').json()['difficulty_weight'] == 7
    assert first['difficulty_weight'] == 2
