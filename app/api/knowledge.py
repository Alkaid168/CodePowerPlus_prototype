"""知识树接口：浏览、搜索与详情。"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.container import Container, get_container
from app.errors import InvalidInput, NotFound
from app.knowledge_graph import load_graph
from app.knowledge_weights import load_weights, with_weights
from app.schemas import KnowledgeDetailOut, KnowledgeSearchOut, KnowledgeTreeOut

router = APIRouter(prefix='/api/knowledge', tags=['knowledge'])


def _level(value: str | None) -> int | None:
    if not value:
        return None
    text = value.upper().removeprefix('L')
    if text not in {'1', '2', '3'}:
        raise InvalidInput('level 只能是 1、2、3 或 L1、L2、L3')
    return int(text)


@router.get('/tree', response_model=KnowledgeTreeOut)
def knowledge_tree(container: Container = Depends(get_container)):
    nodes = list(container.taxonomy.nodes.values())
    weights = load_weights(container.taxonomy)
    return {'version': container.taxonomy.version, 'total': len(nodes),
            'tree': [with_weights(node, weights) for node in container.taxonomy.tree()]}


@router.get('/search', response_model=KnowledgeSearchOut)
def knowledge_search(q: str = '', level: str | None = None,
                     container: Container = Depends(get_container)):
    items = container.taxonomy.search(q, level=_level(level))
    weights = load_weights(container.taxonomy)
    return {'version': container.taxonomy.version, 'total': len(items),
            'items': [with_weights(node, weights) for node in items]}


@router.get('/graph')
def knowledge_graph(container: Container = Depends(get_container)):
    """全部叶子及其学习先修关系；独立于题库和学生学习记录。"""
    result = load_graph(container.taxonomy)
    weights = load_weights(container.taxonomy)
    result['nodes'] = [with_weights(node, weights) for node in result['nodes']]
    return result


def _knowledge_detail(knowledge_id: str, container: Container) -> dict:
    node = container.taxonomy.get(knowledge_id)
    if node is None:
        raise NotFound(f'知识点 {knowledge_id} 不存在')
    weights = load_weights(container.taxonomy)
    return {**with_weights(node, weights),
            'ancestors': [with_weights(item, weights) for item in container.taxonomy.ancestors(knowledge_id)],
            'children': [with_weights(item, weights) for item in container.taxonomy.children(knowledge_id)]}


@router.get('/node/{knowledge_id:path}', response_model=KnowledgeDetailOut)
def knowledge_node_detail(knowledge_id: str, container: Container = Depends(get_container)):
    """独立详情命名空间，避免 search/tree 等保留路径与节点 ID 冲突。"""
    return _knowledge_detail(knowledge_id, container)


@router.get('/{knowledge_id:path}', response_model=KnowledgeDetailOut)
def knowledge_detail(knowledge_id: str, container: Container = Depends(get_container)):
    """兼容旧调用；新前端统一使用 /node/{id}。"""
    return _knowledge_detail(knowledge_id, container)
