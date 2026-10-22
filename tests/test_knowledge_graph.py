"""只读先修图：全量叶子、严格内容校验和文件更新。"""
import copy
import json

import pytest

from app.knowledge import Taxonomy


def graph_data(**overrides):
    return {
        'version': '2026.10.1',
        'taxonomy_version': '2026.10.1',
        'provenance': 'agent-curated-prerequisites-v1; not teacher-reviewed',
        'edges': [{
            'source': 'ds.stack',
            'target': 'search.dfs',
            'reason': '理解递归调用栈，才能追踪深度优先搜索的回溯过程。',
            'references': ['https://oi-wiki.org/search/dfs/'],
        }],
        **overrides,
    }


@pytest.fixture()
def graph_path(tmp_path):
    path = tmp_path / 'graph.json'
    path.write_text(json.dumps(graph_data(), ensure_ascii=False), encoding='utf-8')
    return path


def load_graph(taxonomy, path):
    # 延后导入使缺失功能表现为明确的用例失败，便于红绿记录。
    from app.knowledge_graph import load_graph as load
    return load(taxonomy, path)


def test_graph_contains_every_leaf_including_isolated_nodes(graph_path):
    taxonomy = Taxonomy()
    result = load_graph(taxonomy, graph_path)
    assert len(result['nodes']) == 337
    assert {node['id'] for node in result['nodes']} == {
        node['id'] for node in taxonomy.leaves()
    }
    assert result['edges'] == graph_data()['edges']
    stack = next(node for node in result['nodes'] if node['id'] == 'ds.stack')
    assert stack == {
        'id': 'ds.stack', 'name': taxonomy.get('ds.stack')['name'],
        'summary': taxonomy.get('ds.stack')['summary'],
        'domain_id': 'ds', 'domain_name': '数据结构',
    }
    assert len(result['domains']) == 10
    assert sum(domain['count'] for domain in result['domains']) == 337
    assert all(domain['count'] == sum(
        node['domain_id'] == domain['id'] for node in result['nodes']
    ) for domain in result['domains'])


@pytest.mark.parametrize('change', [
    {'version': '1999.1.1'},
    {'version': 1},
    {'taxonomy_version': '1999.1.1'},
    {'taxonomy_version': None},
    {'provenance': ''},
    {'provenance': 'teacher-reviewed'},
    {'provenance': []},
    {'extra': 'unexpected'},
    {'edges': None},
    {'edges': {}},
    {'edges': [None]},
])
def test_invalid_graph_metadata_fails_explicitly(graph_path, change):
    from app.knowledge_graph import KnowledgeGraphError
    graph_path.write_text(json.dumps(graph_data(**change)), encoding='utf-8')
    with pytest.raises(KnowledgeGraphError):
        load_graph(Taxonomy(), graph_path)


@pytest.mark.parametrize('field', ['version', 'taxonomy_version', 'provenance', 'edges'])
def test_required_graph_metadata_cannot_be_omitted(graph_path, field):
    from app.knowledge_graph import KnowledgeGraphError
    data = graph_data()
    del data[field]
    graph_path.write_text(json.dumps(data), encoding='utf-8')
    with pytest.raises(KnowledgeGraphError):
        load_graph(Taxonomy(), graph_path)


@pytest.mark.parametrize('change', [
    {'source': 'not.exists'},
    {'source': 'ds'},
    {'source': 'math.number-theory'},
    {'source': ['ds.stack']},
    {'target': 'not.exists'},
    {'target': 'search'},
    {'target': 12},
    {'target': 'ds.stack'},
    {'reason': ''},
    {'reason': ' \n '},
    {'reason': 12},
    {'references': []},
    {'references': ['']},
    {'references': ['   ']},
    {'references': [12]},
    {'references': 'https://oi-wiki.org/'},
    {'references': ['javascript:alert(1)']},
    {'references': ['https:///missing-host']},
    {'extra': 'unexpected'},
])
def test_invalid_edges_fail_explicitly(graph_path, change):
    from app.knowledge_graph import KnowledgeGraphError
    data = graph_data()
    data['edges'][0].update(change)
    graph_path.write_text(json.dumps(data), encoding='utf-8')
    with pytest.raises(KnowledgeGraphError):
        load_graph(Taxonomy(), graph_path)


@pytest.mark.parametrize('field', ['source', 'target', 'reason', 'references'])
def test_required_edge_fields_cannot_be_omitted(graph_path, field):
    from app.knowledge_graph import KnowledgeGraphError
    data = graph_data()
    del data['edges'][0][field]
    graph_path.write_text(json.dumps(data), encoding='utf-8')
    with pytest.raises(KnowledgeGraphError):
        load_graph(Taxonomy(), graph_path)


@pytest.mark.parametrize('targets', [
    [('ds.stack', 'search.dfs'), ('ds.stack', 'search.dfs')],
    [('ds.stack', 'search.dfs'), ('search.dfs', 'ds.stack')],
    [('ds.stack', 'search.dfs'), ('search.dfs', 'graph.dfs'), ('graph.dfs', 'ds.stack')],
])
def test_duplicates_and_cycles_fail_explicitly(graph_path, targets):
    from app.knowledge_graph import KnowledgeGraphError
    edge = graph_data()['edges'][0]
    data = graph_data(edges=[{**edge, 'source': source, 'target': target}
                             for source, target in targets])
    graph_path.write_text(json.dumps(data), encoding='utf-8')
    with pytest.raises(KnowledgeGraphError):
        load_graph(Taxonomy(), graph_path)


def test_missing_and_malformed_files_do_not_turn_into_empty_graphs(graph_path):
    from app.knowledge_graph import KnowledgeGraphError
    taxonomy = Taxonomy()
    graph_path.unlink()
    with pytest.raises(KnowledgeGraphError):
        load_graph(taxonomy, graph_path)
    for content in ['{broken', '[]', 'null', '{"version": 1, "version": 2}']:
        graph_path.write_text(content, encoding='utf-8')
        with pytest.raises(KnowledgeGraphError):
            load_graph(taxonomy, graph_path)


def test_file_updates_and_bad_updates_are_never_hidden_by_cache(graph_path):
    from app.knowledge_graph import KnowledgeGraphError
    taxonomy = Taxonomy()
    original = load_graph(taxonomy, graph_path)
    original['edges'].clear()
    original['nodes'][0]['name'] = '调用者修改'
    assert load_graph(taxonomy, graph_path)['edges'] == graph_data()['edges']
    updated = graph_data(edges=[])
    graph_path.write_text(json.dumps(updated), encoding='utf-8')
    result = load_graph(taxonomy, graph_path)
    assert result['edges'] == []
    assert len(result['nodes']) == 337
    graph_path.write_text('{broken', encoding='utf-8')
    with pytest.raises(KnowledgeGraphError):
        load_graph(taxonomy, graph_path)


def test_loading_graph_never_changes_taxonomy_or_content_file(graph_path):
    taxonomy = Taxonomy()
    before_taxonomy = copy.deepcopy(taxonomy.data)
    before_file = graph_path.read_bytes()
    load_graph(taxonomy, graph_path)
    assert taxonomy.data == before_taxonomy
    assert graph_path.read_bytes() == before_file


def node_override(**overrides):
    return {
        'summary': '2-SAT 要求每个子句至多包含两个文字，通过蕴含图与强连通分量判断可满足性。',
        'references': ['https://oi-wiki.org/graph/2-sat/'],
        **overrides,
    }


def test_graph_summary_override_corrects_content_without_changing_taxonomy(graph_path):
    taxonomy = Taxonomy()
    before_taxonomy = copy.deepcopy(taxonomy.data)
    before_taxonomy_file = taxonomy.path.read_bytes()
    old_summary = next(node for node in load_graph(taxonomy, graph_path)['nodes']
                       if node['id'] == 'graph.2-sat')['summary']
    correction = node_override()
    graph_path.write_text(json.dumps(graph_data(node_overrides={'graph.2-sat': correction})),
                          encoding='utf-8')
    result = load_graph(taxonomy, graph_path)
    assert next(node for node in result['nodes']
                if node['id'] == 'graph.2-sat')['summary'] == correction['summary']
    assert old_summary != correction['summary']
    assert next(node for node in result['nodes']
                if node['id'] == 'ds.stack')['summary'] == taxonomy.get('ds.stack')['summary']
    assert taxonomy.data == before_taxonomy
    assert taxonomy.path.read_bytes() == before_taxonomy_file
    assert set(result) == {'version', 'taxonomy_version', 'provenance', 'nodes', 'edges', 'domains'}


@pytest.mark.parametrize('overrides', [
    None,
    [],
    {'missing.leaf': node_override()},
    {'graph': node_override()},
    {'math.number-theory': node_override()},
    {'graph.2-sat': None},
    {'graph.2-sat': {}},
    {'graph.2-sat': node_override(summary='')},
    {'graph.2-sat': node_override(summary=' ' * 20)},
    {'graph.2-sat': node_override(summary='短' * 19)},
    {'graph.2-sat': node_override(summary='长' * 401)},
    {'graph.2-sat': node_override(summary=42)},
    {'graph.2-sat': node_override(references=[])},
    {'graph.2-sat': node_override(references=[''])},
    {'graph.2-sat': node_override(references=['javascript:alert(1)'])},
    {'graph.2-sat': node_override(references=[1])},
    {'graph.2-sat': node_override(extra=True)},
    {'graph.2-sat': {'summary': node_override()['summary']}},
    {'graph.2-sat': {'references': ['https://oi-wiki.org/graph/2-sat/']}},
])
def test_invalid_node_overrides_are_rejected(graph_path, overrides):
    from app.knowledge_graph import KnowledgeGraphError
    graph_path.write_text(json.dumps(graph_data(node_overrides=overrides)), encoding='utf-8')
    with pytest.raises(KnowledgeGraphError):
        load_graph(Taxonomy(), graph_path)


@pytest.mark.parametrize('summary', ['字' * 20, '字' * 400])
def test_override_summary_accepts_inclusive_length_boundaries(graph_path, summary):
    graph_path.write_text(json.dumps(graph_data(
        node_overrides={'graph.2-sat': node_override(summary=summary)})), encoding='utf-8')
    result = load_graph(Taxonomy(), graph_path)
    assert next(node for node in result['nodes'] if node['id'] == 'graph.2-sat')['summary'] == summary
