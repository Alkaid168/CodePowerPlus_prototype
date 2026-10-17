"""知识树：只保留名称与层级，L2 既可以是分支也可以是知识点。"""
import copy
import json

import pytest

from app.knowledge import ROOT, Taxonomy, TaxonomyError


def load_modified(tmp_path, mutate):
    data = copy.deepcopy(Taxonomy().data)
    mutate(data)
    path = tmp_path / 'taxonomy.json'
    path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    return Taxonomy(path)


@pytest.mark.parametrize('mutate', [
    lambda d: d['nodes'][0].update(definition='多出来的字段'),
    lambda d: d['nodes'][0].update(name='  '),
    lambda d: d['nodes'][0].update(level=True),
    lambda d: d['nodes'][0].update(level=4),
    lambda d: d['nodes'][0].update(parent_id='math'),
    lambda d: d['nodes'].append(copy.deepcopy(d['nodes'][0])),
    lambda d: d.pop('version'),
])
def test_invalid_catalog_rejected(tmp_path, mutate):
    with pytest.raises(TaxonomyError):
        load_modified(tmp_path, mutate)


def test_parent_must_exist_and_levels_stay_continuous(tmp_path):
    def missing_parent(d):
        next(n for n in d['nodes'] if n['level'] == 3)['parent_id'] = 'not.exists'

    def skipped_level(d):
        next(n for n in d['nodes'] if n['level'] == 3)['parent_id'] = 'math'

    for mutate in (missing_parent, skipped_level):
        with pytest.raises(TaxonomyError):
            load_modified(tmp_path, mutate)


ALLOWED_FIELDS = {'id', 'name', 'level', 'parent_id', 'summary', 'intro_rating'}


def test_node_fields_are_structure_plus_leaf_summary():
    """语法章节可带介绍和门槛；原算法分支维持精简结构。"""
    taxonomy = Taxonomy()
    leaves = {node['id'] for node in taxonomy.leaves()}
    for node in taxonomy.data['nodes']:
        assert set(node) <= ALLOWED_FIELDS
        if node['id'] in leaves:
            assert node.get('summary')
        elif not node['id'].startswith('syntax.'):
            assert 'summary' not in node


def test_every_leaf_has_a_useful_summary():
    taxonomy = Taxonomy()
    leaves = taxonomy.leaves()
    assert len(leaves) >= 300
    texts = set()
    for node in leaves:
        summary = node['summary']
        assert 50 <= len(summary) <= 200, node['id']
        assert summary == summary.strip() and '\n' not in summary
        assert summary != node['name']
        for word in ('待补充', 'TODO', '本知识点', '本文将', '学习目标', '前置知识'):
            assert word not in summary, node['id']
        texts.add(summary)
    assert len(texts) == len(leaves)


def test_l2_and_l3_can_be_tags_but_l1_cannot():
    taxonomy = Taxonomy()
    assert taxonomy.allowed(['math.number-theory.prime'])      # L3 知识点
    assert taxonomy.allowed(['math.number-theory'])            # L2 分支
    assert taxonomy.allowed(['math.binary-exponentiation'])    # L2 知识点（快速幂）
    assert not taxonomy.allowed(['math'])
    assert not taxonomy.allowed(['invented.knowledge'])
    assert not taxonomy.allowed([])


def test_branch_leaf_and_tree_navigation():
    taxonomy = Taxonomy()
    assert [node['id'] for node in taxonomy.ancestors('math.number-theory.prime')] == ['math', 'math.number-theory']
    assert taxonomy.branch('math.number-theory.prime') == 'math.number-theory'
    assert taxonomy.branch('math.binary-exponentiation') == 'math.binary-exponentiation'
    assert taxonomy.children('math.binary-exponentiation') == []
    assert [node['name'] for node in taxonomy.tree()] == [
        '语法基础', '算法基础', '搜索', '动态规划', '字符串', '数学', '数据结构', '图论', '计算几何', '杂项']
    assert [node['id'] for node in taxonomy.search('快速幂')] == ['math.binary-exponentiation']
    with pytest.raises(TaxonomyError):
        taxonomy.ancestors('unknown')


def test_validate_assignment_rules():
    taxonomy = Taxonomy()
    cases = [
        ([], [], {}, None),
        (['math'], [], {'math': '领域不能做标签'}, None),
        (['invented'], [], {'invented': '不存在'}, None),
        (['math.number-theory', 'math.number-theory.prime'], [],
         {'math.number-theory': '分支', 'math.number-theory.prime': '素数'}, None),
        (['math.number-theory.prime'], [], {}, None),
        (['math.number-theory.prime'], [], {'math.number-theory.prime': '  '}, None),
        (['math.number-theory.prime'], [], {'math.number-theory.prime': '素数'},
         {'math.number-theory.prime': 1.5}),
    ]
    for primary, secondary, evidence, confidence in cases:
        with pytest.raises(TaxonomyError):
            taxonomy.validate_assignment(primary, secondary, evidence, confidence)
    taxonomy.validate_assignment(['math.number-theory.prime'], [],
                                 {'math.number-theory.prime': '试除判素数'},
                                 {'math.number-theory.prime': 0.8})
    # 同一 L2 分支可以有多个主标签：筛法和素数经常同时出现在一道题里。
    same_branch = ['math.number-theory.prime', 'math.number-theory.sieve']
    taxonomy.validate_assignment(same_branch, [],
                                 {node_id: '先筛后判' for node_id in same_branch},
                                 {node_id: 0.8 for node_id in same_branch})


def test_catalog_scale_and_unique_names():
    taxonomy = Taxonomy()
    nodes = taxonomy.data['nodes']
    assert taxonomy.data['version'] == '2026.10.1'
    assert len(nodes) == 377
    assert len(taxonomy.tree()) == 10
    assert len({node['name'] for node in nodes}) == len(nodes)
    levels = {node['id']: node['level'] for node in nodes}
    for node in nodes:
        assert node['name'].strip()
        if node['level'] == 1:
            assert node['parent_id'] is None
        else:
            assert levels[node['parent_id']] == node['level'] - 1


def test_no_course_or_tool_style_nodes():
    """旧算法快照保留去课程目录结果；新语法词表另有专门的题型边界测试。"""
    banned_parts = ('编译', '调试', 'C++', '标准库', '专题')
    banned_names = {'变量', '函数', '数组', '指针', '结构体', '类', '引用', '常量', '命名空间', '文件操作'}
    for node in Taxonomy(ROOT / 'data/taxonomy_versions/2026.09.9.json').data['nodes']:
        assert node['name'] not in banned_names, node['name']
        for word in banned_parts:
            assert word not in node['name'], node['name']


def test_revised_tag_catalog_for_2026_09_8():
    """目录按题目标签原则清理后，关键层级与叶子介绍保持一致。"""
    taxonomy = Taxonomy(ROOT / 'data/taxonomy_versions/2026.09.9.json')
    nodes = {node['id']: node for node in taxonomy.data['nodes']}
    assert taxonomy.version == '2026.09.9'

    removed_ids = {
        'basic.complexity', 'basic.amortized-analysis', 'basic.stl-sort',
        'search.backtracking', 'search.opt', 'dp.basic', 'dp.opt.state',
        'string.lib-func', 'string.sa-optimal-inplace',
        'math.number-theory.mod-arithmetic', 'math.lp', 'math.algebra',
        'math.algebra.basic', 'math.algebra.group-theory', 'math.algebra.ring-theory',
        'math.algebra.field-theory', 'math.algebra.schreier-sims',
        'math.probability.basic-conception', 'math.probability.conditional-probability',
        'math.probability.random-variable', 'math.probability.exp-var',
        'math.probability.concentration-inequality',
        'math.game-theory.impartial-game', 'math.game-theory.zero-sum-game',
        'math.game-theory.partizan-game', 'ds.dsu-complexity', 'ds.seg-beats',
        'graph.concept', 'graph.save', 'geometry.distance', 'misc.offline',
        'misc.random', 'misc.fsm', 'misc.cc-basic', 'misc.endianness',
        'misc.josephus', 'misc.expression', 'misc.job-order', 'misc.15-puzzle',
        'misc.dsu-app', 'misc.bracket', 'misc.segment-tree-offline',
        'misc.interaction', 'misc.io-optimization', 'misc.dictionary', 'misc.bitset',
    }
    assert removed_ids.isdisjoint(nodes)

    assert nodes['basic']['name'] == '基础'
    assert nodes['basic.divide-and-conquer']['name'] == '分治'
    assert nodes['basic.prefix-sum']['name'] == '前缀和'
    assert nodes['basic.difference']['parent_id'] == 'basic'
    assert nodes['search.dfs']['name'] == '深度优先搜索（DFS）'
    assert nodes['search.bfs']['name'] == '广度优先搜索（BFS）'
    assert nodes['graph.dfs']['name'] == '图上深度优先搜索（DFS）'
    assert nodes['graph.bfs']['name'] == '图上广度优先搜索（BFS）'
    assert nodes['dp.dag']['name'] == 'DAG DP'
    assert nodes['dp.profile']['name'] == '轮廓线 DP'
    assert nodes['dp.misc']['name'] == '其他 DP'
    assert nodes['string.sa']['name'] == '后缀数组（SA）'
    assert taxonomy.children('string.sa') == []
    assert nodes['math.simplex']['level'] == 2 and nodes['math.simplex']['parent_id'] == 'math'
    assert nodes['math.number-theory.fermat']['name'] == '费马小定理'
    assert nodes['math.number-theory.euler-theorem']['name'] == '欧拉定理'
    assert nodes['math.number-theory.inverse']['name'] == '逆元'
    assert taxonomy.children('math.probability') == []
    assert taxonomy.children('math.game-theory') == []
    assert taxonomy.children('ds.union-find') == []
    assert nodes['ds.union-find-extended']['name'] == '扩展域并查集'
    assert nodes['ds.union-find-weighted']['name'] == '带权并查集'
    assert nodes['ds.segment-tree.basic']['name'] == '线段树基础'
    assert nodes['ds.persistent.other']['name'] == '其他可持久化数据结构'
    assert nodes['ds.tree-in-tree.other']['name'] == '其他树套树'
    assert nodes['graph.basic']['name'] == '图论基础'
    assert nodes['graph.cut']['name'] == '割点'
    assert nodes['graph.bridge']['name'] == '桥'
    assert nodes['graph.flow.max-flow-min-cut']['name'] == '最大流最小割定理'
    assert nodes['misc.cdq-divide']['level'] == 2
    assert nodes['misc.parallel-binsearch']['level'] == 2

    for node_id in {
        'basic.difference', 'dp.profile', 'string.sa', 'math.number-theory.fermat',
        'math.number-theory.euler-theorem', 'math.number-theory.inverse',
        'math.probability', 'math.game-theory', 'ds.union-find',
        'ds.union-find-extended', 'ds.union-find-weighted', 'ds.segment-tree.basic',
        'ds.persistent.other', 'ds.tree-in-tree.other', 'graph.basic', 'graph.bridge',
        'graph.flow.max-flow-min-cut',
    }:
        summary = nodes[node_id].get('summary', '')
        assert 50 <= len(summary) <= 200, node_id


def test_follow_up_tag_cleanup_for_2026_09_9():
    taxonomy = Taxonomy(ROOT / 'data/taxonomy_versions/2026.09.9.json')
    nodes = {node['id']: node for node in taxonomy.data['nodes']}
    assert taxonomy.version == '2026.09.9'
    assert 'math.coordinate' not in nodes
    assert 'misc.space-optimization' not in nodes
    assert nodes['math.numeral-system']['name'] == '进位制'
    assert nodes['math.numeral-sys.base']['name'] == '进制转换'
    summary = nodes['geometry.2d']['summary']
    assert '坐标系' in summary and '弧度' in summary
