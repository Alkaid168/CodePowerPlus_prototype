"""执行真实前端编辑器，防止旧标签规则在手工标注与审核纠正中复发。"""
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

# 仅替代 DOM 与界面依赖；read()、行数据和词表均使用真实实现。
PROBE = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
(async () => {
  const context = vm.createContext({});
  const nodes = JSON.parse(fs.readFileSync('data/knowledge_taxonomy.json', 'utf8')).nodes;
  const h = (tag, props = {}, ...children) => ({ ...props, tag, children, addEventListener() {} });
  const dependencies = {
    './api.js': { api: {} },
    './dom.js': { h, mount: () => {} },
    './components.js': { button: (label, props) => h('button', props), field: (...args) => args },
    './search.js': { matchesSearch: () => true },
    './store.js': { store: { ensureKnowledge: async () => nodes } },
  };
  const module = new vm.SourceTextModule(fs.readFileSync('app/static/js/tagEditor.js', 'utf8'), { context });
  await module.link(async (specifier) => {
    const data = dependencies[specifier];
    assert.ok(data, `Unexpected import: ${specifier}`);
    return new vm.SyntheticModule(Object.keys(data), function () {
      for (const [key, value] of Object.entries(data)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  const ids = ['math.number-theory.prime', 'math.number-theory.sieve'];
  assert.equal(nodes.find(node => node.id === ids[0]).parent_id,
               nodes.find(node => node.id === ids[1]).parent_id);
  const rows = ids.map(id => ({ id, role: 'primary', evidence: `${id} supports the solution`, confidence: 0.8 }));
  const editor = await module.namespace.createTagEditor(rows);
  const payload = JSON.parse(JSON.stringify(editor.read()));
  assert.deepEqual(payload.primary_knowledge_ids, ids);
  assert.deepEqual(Object.keys(payload.evidence), ids);
  assert.deepEqual(Object.keys(payload.knowledge_confidence), ids);
  editor.reset([rows[0], rows[0]]);
  assert.throws(() => editor.read(), /重复/);
  editor.reset([{ ...rows[0], evidence: '' }]);
  assert.throws(() => editor.read(), /证据/);
  editor.reset([{ ...rows[0], role: 'secondary' }]);
  assert.throws(() => editor.read(), /主知识点/);
})().catch(error => { console.error(error); process.exitCode = 1; });
"""


def test_same_branch_primary_tags_are_allowed_without_losing_existing_guards():
    node = shutil.which('node')
    if node is None:
        pytest.skip('前端行为回归检查需要 Node.js')
    result = subprocess.run(
        [node, '--experimental-vm-modules', '--no-warnings', '-e', PROBE],
        cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=20)
    assert result.returncode == 0, result.stderr
