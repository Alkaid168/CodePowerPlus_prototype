"""Versioned L1/L2/L3 knowledge tree: the vocabulary used to tag problems.

节点只保存 id、名称与层级；这里不做学习顺序、难度或讲解内容，那些属于题目分析
与教学环节，不影响“一道题考什么”这件事本身。
"""
import json
import re
from pathlib import Path

from jsonschema import Draft202012Validator


class TaxonomyError(ValueError):
    """Invalid knowledge tree or invalid knowledge assignment."""


_SEARCH_SEPARATORS = re.compile(r'[\s._\-/()（）]+')


def _search_text(value: str) -> str:
    return ' '.join(_SEARCH_SEPARATORS.sub(' ', value.casefold()).split())


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATH = ROOT / 'data' / 'knowledge_taxonomy.json'
SCHEMA_PATH = ROOT / 'data' / 'knowledge_taxonomy.schema.json'


class Taxonomy:
    def __init__(self, path=None, schema_path=None):
        self.path = Path(path) if path is not None else DEFAULT_PATH
        self.schema_path = Path(schema_path) if schema_path is not None else SCHEMA_PATH
        try:
            self.data = json.loads(self.path.read_text(encoding='utf-8'))
        except (OSError, ValueError) as exc:
            raise TaxonomyError(f'Cannot read taxonomy: {exc}') from exc
        self.validate()

    def validate(self):
        schema = json.loads(self.schema_path.read_text(encoding='utf-8'))
        error = next(Draft202012Validator(schema).iter_errors(self.data), None)
        if error:
            location = '.'.join(map(str, error.absolute_path)) or '<root>'
            raise TaxonomyError(f'Schema {location}: {error.message}')
        raw = self.data['nodes']
        self.version = self.data['version']
        self.nodes = {node['id']: node for node in raw}
        if len(self.nodes) != len(raw):
            raise TaxonomyError('Duplicate node ID')
        if not any(node['level'] == 1 for node in raw):
            raise TaxonomyError('Taxonomy needs at least one L1 domain')
        for node in raw:
            parent_id = node['parent_id']
            if node['level'] == 1:
                if parent_id is not None:
                    raise TaxonomyError(f'L1 node must not have a parent: {node["id"]}')
                continue
            parent = self.nodes.get(parent_id)
            if parent is None or parent['level'] != node['level'] - 1:
                raise TaxonomyError(f'Invalid parent or skipped level: {node["id"]}')
        # 叶子知识点要有一段介绍；分支节点只需要名称。
        parents = {node['parent_id'] for node in raw if node['parent_id']}
        for node in raw:
            if node['id'] in parents:
                continue
            summary = node.get('summary')
            if not isinstance(summary, str) or not 20 <= len(summary.strip()) <= 400:
                raise TaxonomyError(f'Leaf node needs a 20-400 character summary: {node["id"]}')

    def get(self, node_id):
        return self.nodes.get(node_id)

    def children(self, parent_id=None):
        return [node for node in self.nodes.values() if node['parent_id'] == parent_id]

    def leaves(self):
        """叶子知识点：没有下级的 L2，以及全部 L3。"""
        parents = {node['parent_id'] for node in self.nodes.values() if node['parent_id']}
        return [node for node in self.nodes.values()
                if node['level'] > 1 and (node['level'] == 3 or node['id'] not in parents)]

    def tree(self):
        def build(node):
            return {**node, 'children': [build(child) for child in self.children(node['id'])]}
        return [build(node) for node in self.children()]

    def search(self, q='', level=None):
        query = _search_text(q or '')
        return [node for node in self.nodes.values()
                if (level is None or node['level'] == level)
                and (not query or query in _search_text(f"{node['name']} {node['id']}"))]

    def allowed(self, ids):
        """L2/L3 IDs are usable as tags; L1 domains only aggregate statistics."""
        return isinstance(ids, (list, tuple)) and bool(ids) and all(
            isinstance(node_id, str) and node_id in self.nodes and self.nodes[node_id]['level'] in (2, 3)
            for node_id in ids)

    def ancestors(self, node_id):
        if node_id not in self.nodes:
            raise TaxonomyError(f'Unknown knowledge ID: {node_id}')
        result = []
        parent = self.nodes[node_id]['parent_id']
        while parent is not None:
            result.insert(0, self.nodes[parent])
            parent = self.nodes[parent]['parent_id']
        return result

    def branch(self, node_id):
        """L2 branch that a tag belongs to; an L2 node is its own branch."""
        node = self.nodes[node_id]
        return node_id if node['level'] == 2 else node['parent_id']

    def describe(self):
        return '\n'.join(f'{node["id"]}: {node["name"]}' for node in self.nodes.values()
                         if node['level'] > 1)

    def validate_assignment(self, primary, secondary, evidence, knowledge_confidence=None):
        if not self.allowed(primary) or not isinstance(secondary, (list, tuple)) or (secondary and not self.allowed(secondary)):
            raise TaxonomyError('Use at least one active L2/L3 primary knowledge ID')
        selected = list(primary) + list(secondary)
        if len(set(selected)) != len(selected):
            raise TaxonomyError('Knowledge IDs must not be duplicated')
        if not isinstance(evidence, dict) or set(evidence) != set(selected) or any(
                not isinstance(value, str) or not value.strip() for value in evidence.values()):
            raise TaxonomyError('Every selected ID needs exactly one nonempty evidence explanation')
        selected_set = set(selected)
        for node_id in selected:
            if any(ancestor['id'] in selected_set for ancestor in self.ancestors(node_id)):
                raise TaxonomyError('Do not select both ancestor and descendant')
        # 同一 L2 分支允许有多个主标签：一道题可能同时用到“素数”和“筛法”，
        # 或者既可以用树状数组也可以用线段树，这些都应该如实标出。
        if knowledge_confidence is not None:
            if not isinstance(knowledge_confidence, dict) or set(knowledge_confidence) != selected_set or any(
                    type(value) not in (float, int) or not 0 <= value <= 1 for value in knowledge_confidence.values()):
                raise TaxonomyError('Every selected ID needs a numeric confidence in [0, 1]')
