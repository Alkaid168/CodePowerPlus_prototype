"""Independent, versioned content weights; never writes taxonomy or learner records."""
from __future__ import annotations

import json
from pathlib import Path
from weakref import WeakKeyDictionary

from app.errors import DomainError
from app.knowledge import Taxonomy

DEFAULT_PATH = Path(__file__).resolve().parents[1] / 'data' / 'knowledge_weights.json'
_CACHE: WeakKeyDictionary = WeakKeyDictionary()


class KnowledgeWeightsError(DomainError, ValueError):
    status_code = 503
    code = 'knowledge_weights_invalid'


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise KnowledgeWeightsError(f'知识权重含重复字段：{key}')
        result[key] = value
    return result


def load_weights(taxonomy: Taxonomy, path=None) -> dict:
    """Require exact ID coverage and integer ranges. Revalidate changed bytes."""
    weight_path = Path(path) if path is not None else DEFAULT_PATH
    try:
        raw = weight_path.read_bytes()
    except OSError as exc:
        raise KnowledgeWeightsError(f'无法读取知识权重：{exc}') from exc
    signature = (weight_path, raw, taxonomy.version, frozenset(taxonomy.nodes))
    cached = _CACHE.get(taxonomy)
    if cached is not None and cached[0] == signature:
        return {key: dict(value) for key, value in cached[1].items()}
    try:
        data = json.loads(raw.decode('utf-8'), object_pairs_hook=_unique)
    except (UnicodeError, ValueError) as exc:
        raise KnowledgeWeightsError(f'无法解析知识权重：{exc}') from exc
    if (not isinstance(data, dict)
            or set(data) != {'version', 'taxonomy_version', 'scope', 'nodes'}
            or data['version'] != '2026.10.1'
            or data['taxonomy_version'] != taxonomy.version
            or data['scope'] != 'competitive-programming-training'):
        raise KnowledgeWeightsError('知识权重版本、用途或字段不合法')
    nodes = data['nodes']
    if not isinstance(nodes, dict) or set(nodes) != set(taxonomy.nodes):
        raise KnowledgeWeightsError('知识权重必须完整覆盖当前词表，且不能包含额外节点')
    for node_id, weights in nodes.items():
        if (not isinstance(weights, dict)
                or set(weights) != {'difficulty_weight', 'importance_weight'}
                or type(weights['difficulty_weight']) is not int
                or not 1 <= weights['difficulty_weight'] <= 8
                or type(weights['importance_weight']) is not int
                or not 1 <= weights['importance_weight'] <= 5):
            raise KnowledgeWeightsError(f'知识权重 {node_id} 需要难度整数1–8、重要度整数1–5')
    _CACHE[taxonomy] = (signature, nodes)
    return {key: dict(value) for key, value in nodes.items()}


def with_weights(node: dict, weights: dict) -> dict:
    """Enrich a copy, including nested tree children; keep source nodes immutable."""
    result = {**node, **weights[node['id']]}
    if 'children' in node:
        result['children'] = [with_weights(child, weights) for child in node['children']]
    return result
