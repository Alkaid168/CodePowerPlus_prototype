/* 知识点检索的唯一实现：中文名和英文 ID 都能匹配。

分隔符（空格、点、横线、斜杠、括号）统一归一化，因此
`shortest path` 能命中 `graph.shortest-path`，`dfs` 能命中 `DFS`。
知识树页面和标签编辑器共用这一份，避免两边搜索行为不一致。
*/
export function normalizeSearch(value) {
  return String(value || '').toLowerCase().replace(/[\s._\-/()（）]+/g, ' ').trim();
}

export function matchesSearch(node, keyword) {
  const query = normalizeSearch(keyword);
  return !query || normalizeSearch(`${node.name} ${node.id}`).includes(query);
}
