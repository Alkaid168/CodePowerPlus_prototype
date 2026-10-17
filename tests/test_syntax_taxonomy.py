"""C 入门词表：门槛是标签适用下限，旧算法标签和历史快照保持兼容。"""
import copy
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
CHAPTERS = {
    'syntax.output': (100, {'literal-output', 'escape-output'}),
    'syntax.variables-io': (200, {'variables', 'numeric-input', 'formatted-output'}),
    'syntax.expressions': (300, {'arithmetic', 'division-remainder', 'conversion'}),
    'syntax.conditions': (400, {'comparison', 'logical-condition', 'multi-branch'}),
    'syntax.loops-arrays': (500, {'for-while', 'loop-accumulation', 'array-traversal',
                                 'array-basic-update', 'nested-loop'}),
    'syntax.characters-strings': (600, {'char-classification', 'string-input',
                                      'string-traversal', 'string-comparison'}),
    'syntax.basic-integration': (700, {'digit-loop', 'divisor-trial', 'prime-trial',
                                      'loop-integration'}),
}


def catalog():
    return json.loads((DATA / 'knowledge_taxonomy.json').read_text(encoding='utf-8'))


def test_new_catalog_is_frozen_as_2026_10_1():
    data = catalog()
    assert data['version'] == '2026.10.1'
    assert data == json.loads((DATA / 'taxonomy_versions/2026.10.1.json').read_text(encoding='utf-8'))
    assert len(data['nodes']) == 377


def test_all_previous_nodes_survive_with_only_basic_domain_renamed():
    old = json.loads((DATA / 'taxonomy_versions/2026.09.9.json').read_text(encoding='utf-8'))
    current = {node['id']: node for node in catalog()['nodes']}
    for node in old['nodes']:
        expected = copy.deepcopy(node)
        if node['id'] == 'basic':
            expected['name'] = '算法基础'
        assert current[node['id']] == expected, node['id']
    assert len(old['nodes']) == 345


def test_syntax_root_and_chapters_are_separate_from_algorithms():
    nodes = {node['id']: node for node in catalog()['nodes']}
    assert nodes['syntax'] == {'id': 'syntax', 'name': '语法基础', 'level': 1, 'parent_id': None}
    assert {node['id'] for node in nodes.values() if node['parent_id'] == 'syntax'} == set(CHAPTERS)
    for chapter_id, (rating, suffixes) in CHAPTERS.items():
        chapter = nodes[chapter_id]
        assert chapter['level'] == 2 and chapter['intro_rating'] == rating
        children = [node for node in nodes.values() if node['parent_id'] == chapter_id]
        assert {node['id'] for node in children} == {f'{chapter_id}.{suffix}' for suffix in suffixes}
        assert 2 <= len(children) <= 6
        for child in children:
            assert child['level'] == 3
            assert child['intro_rating'] == rating


def test_only_syntax_labels_carry_intro_rating_and_all_summaries_are_useful():
    summaries = set()
    nodes = catalog()['nodes']
    for node in nodes:
        if node['id'].startswith('syntax.'):
            assert type(node['intro_rating']) is int
            assert node['intro_rating'] in range(100, 701, 100)
            summary = node['summary']
            assert 50 <= len(summary) <= 200, node['id']
            assert summary == summary.strip() and '\n' not in summary
            assert summary not in summaries
            summaries.add(summary)
            assert not any(word in node['name'] for word in ('编译', '调试', '安装', 'IDE'))
        else:
            assert 'intro_rating' not in node
    assert len({node['id'] for node in nodes}) == len(nodes)
    assert len({node['name'] for node in nodes}) == len(nodes)


def test_prime_trial_and_digit_tasks_have_intro_tags_without_moving_number_theory():
    nodes = {node['id']: node for node in catalog()['nodes']}
    prime = nodes['syntax.basic-integration.prime-trial']
    assert prime['intro_rating'] == 700
    assert all(word in prime['summary'] for word in ('小规模', '试除', '筛法'))
    assert nodes['syntax.basic-integration.digit-loop']['intro_rating'] == 700
    assert nodes['syntax.basic-integration.divisor-trial']['intro_rating'] == 700
    assert nodes['math.number-theory.prime']['parent_id'] == 'math.number-theory'
    assert nodes['math.number-theory.sieve']['parent_id'] == 'math.number-theory'
