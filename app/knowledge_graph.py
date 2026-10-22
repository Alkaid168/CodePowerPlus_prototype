"""只读学习先修图；分类节点仍以应用装配的 Taxonomy 为唯一来源。

source 是 target 的学习前置，不表示分类父子关系，也不传播学生分数。
内容是代理整理的初稿，provenance 必须保留未经过教师审核的边界。
"""
from __future__ import annotations

import copy
import json
from collections import deque
from pathlib import Path
from urllib.parse import urlsplit
from weakref import WeakKeyDictionary

from app.errors import DomainError
from app.knowledge import Taxonomy

DEFAULT_PATH = Path(__file__).resolve().parents[1] / 'data' / 'knowledge_graph.json'
GRAPH_VERSION = '2026.10.1'
PROVENANCE = 'agent-curated-prerequisites-v1; not teacher-reviewed'
_CACHE: WeakKeyDictionary = WeakKeyDictionary()


class KnowledgeGraphError(DomainError, ValueError):
    """内容缺失或不合法是服务内容错误，不能伪装为成功的空图。"""

    status_code = 503
    code = 'knowledge_graph_invalid'


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise KnowledgeGraphError(f'知识图谱含重复字段：{key}')
        result[key] = value
    return result


def _fields(value, expected: set[str], location: str, optional: set[str] | None = None) -> None:
    if (not isinstance(value, dict) or not expected.issubset(value)
            or set(value) - expected - (optional or set())):
        raise KnowledgeGraphError(f'知识图谱 {location} 字段不完整或包含额外字段')


def _reference(value) -> bool:
    if not isinstance(value, str) or not value.strip() or any(char.isspace() for char in value):
        return False
    try:
        url = urlsplit(value)
        return url.scheme in {'https', 'http'} and bool(url.hostname) and not url.username and not url.password
    except ValueError:
        return False


def _validate(data, taxonomy: Taxonomy, leaf_ids: set[str]) -> None:
    _fields(data, {'version', 'taxonomy_version', 'provenance', 'edges'}, '<root>',
            optional={'node_overrides'})
    if data['version'] != GRAPH_VERSION:
        raise KnowledgeGraphError(f'知识图谱 version 必须为 {GRAPH_VERSION}')
    if data['taxonomy_version'] != taxonomy.version:
        raise KnowledgeGraphError(f'知识图谱 taxonomy_version 与词表 {taxonomy.version} 不一致')
    if data['provenance'] != PROVENANCE:
        raise KnowledgeGraphError('知识图谱 provenance 必须明确标注代理整理且未经教师审核')
    if not isinstance(data['edges'], list):
        raise KnowledgeGraphError('知识图谱 edges 必须是数组')
    overrides = data.get('node_overrides', {})
    if not isinstance(overrides, dict):
        raise KnowledgeGraphError('知识图谱 node_overrides 必须是对象')
    for node_id, override in overrides.items():
        if node_id not in leaf_ids:
            raise KnowledgeGraphError(f'知识图谱 node_overrides 的键必须为当前叶子 ID：{node_id}')
        location = f'node_overrides[{node_id}]'
        _fields(override, {'summary', 'references'}, location)
        summary = override['summary']
        if not isinstance(summary, str) or not 20 <= len(summary.strip()) <= 400:
            raise KnowledgeGraphError(f'知识图谱 {location} 必须填写 20–400 字的非空介绍')
        references = override['references']
        if not isinstance(references, list) or not references or not all(map(_reference, references)):
            raise KnowledgeGraphError(f'知识图谱 {location} 必须填写非空 HTTP(S) 参考链接数组')
    adjacency = {node_id: [] for node_id in leaf_ids}
    indegree = dict.fromkeys(leaf_ids, 0)
    seen = set()
    for index, edge in enumerate(data['edges']):
        _fields(edge, {'source', 'target', 'reason', 'references'}, f'edges[{index}]')
        source, target = edge['source'], edge['target']
        if (not isinstance(source, str) or not isinstance(target, str)
                or source not in leaf_ids or target not in leaf_ids):
            raise KnowledgeGraphError(f'知识图谱 edges[{index}] 两端必须为当前词表中的叶子 ID')
        if source == target:
            raise KnowledgeGraphError(f'知识图谱不允许自环：{source}')
        if (source, target) in seen:
            raise KnowledgeGraphError(f'知识图谱含重复边：{source} → {target}')
        if not isinstance(edge['reason'], str) or not edge['reason'].strip():
            raise KnowledgeGraphError(f'知识图谱 edges[{index}] 必须填写非空先修理由')
        references = edge['references']
        if not isinstance(references, list) or not references or not all(map(_reference, references)):
            raise KnowledgeGraphError(f'知识图谱 edges[{index}] 必须填写非空 HTTP(S) 参考链接数组')
        seen.add((source, target))
        adjacency[source].append(target)
        indegree[target] += 1
    ready = deque(node_id for node_id, degree in indegree.items() if degree == 0)
    visited = 0
    while ready:
        source = ready.popleft()
        visited += 1
        for target in adjacency[source]:
            indegree[target] -= 1
            if indegree[target] == 0:
                ready.append(target)
    if visited != len(leaf_ids):
        raise KnowledgeGraphError('知识图谱先修关系存在有向环')


def load_graph(taxonomy: Taxonomy, path=None) -> dict:
    """读取并校验内容，返回全部叶子；文件变化即重验，不回退旧缓存。

    每次读取字节以检测同大小、同时间戳的修改；仅 JSON 解析和 DAG 校验缓存。
    缓存按应用词表实例弱引用隔离，不持有数据库或在不同应用间复用节点。
    """
    graph_path = Path(path) if path is not None else DEFAULT_PATH
    try:
        raw = graph_path.read_bytes()
    except OSError as exc:
        raise KnowledgeGraphError(f'无法读取知识图谱：{exc}') from exc
    leaves = taxonomy.leaves()
    leaf_ids = {node['id'] for node in leaves}
    signature = (graph_path, raw, taxonomy.version, frozenset(leaf_ids))
    cached = _CACHE.get(taxonomy)
    if cached is not None and cached[0] == signature:
        data = cached[1]
    else:
        try:
            data = json.loads(raw.decode('utf-8'), object_pairs_hook=_object)
        except (UnicodeError, ValueError) as exc:
            raise KnowledgeGraphError(f'无法解析知识图谱：{exc}') from exc
        _validate(data, taxonomy, leaf_ids)
        _CACHE[taxonomy] = (signature, data)

    domains = {
        node['id']: {'id': node['id'], 'name': node['name'], 'count': 0}
        for node in taxonomy.children()
    }
    nodes = []
    overrides = data.get('node_overrides', {})
    for leaf in leaves:
        domain = taxonomy.ancestors(leaf['id'])[0]
        domains[domain['id']]['count'] += 1
        nodes.append({
            'id': leaf['id'], 'name': leaf['name'],
            'summary': overrides.get(leaf['id'], {}).get('summary', leaf['summary']),
            'domain_id': domain['id'], 'domain_name': domain['name'],
        })
    return {
        'version': data['version'], 'taxonomy_version': data['taxonomy_version'],
        'provenance': data['provenance'], 'nodes': nodes,
        'edges': copy.deepcopy(data['edges']), 'domains': list(domains.values()),
    }
