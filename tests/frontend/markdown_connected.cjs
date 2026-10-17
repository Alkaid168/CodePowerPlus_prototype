const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

(async () => {
  const hosts = [];
  const calls = [];
  let attachOnFrame = true;
  const window = {};
  const math = { startup: { promise: Promise.resolve() }, typesetClear() {},
    async typesetPromise(targets) { calls.push(...targets.map(host => host.isConnected)); } };
  const document = {
    body: {},
    createRange: () => ({ selectNode() {}, createContextualFragment: html => html }),
    createElement: () => ({}),
    head: { append(script) { window.MathJax = math; script.onload(); } },
  };
  const context = vm.createContext({ window, document,
    requestAnimationFrame(callback) {
      queueMicrotask(() => { if (attachOnFrame) hosts.forEach(host => host.isConnected = true); callback(); });
    },
  });
  const marked = new vm.SourceTextModule(fs.readFileSync('app/static/vendor/marked.esm.js', 'utf8'), { context });
  await marked.link(() => { throw new Error('unexpected marked dependency'); });
  const module = new vm.SourceTextModule(fs.readFileSync('app/static/js/markdown.js', 'utf8'), { context });
  await module.link(() => marked);
  await module.evaluate();
  const makeHost = () => {
    const host = { isConnected: false, replaceChildren(value) { this.content = value; } };
    hosts.push(host); return host;
  };
  // Both initial loading and reuse after a page switch must wait for attachment before measuring formulas.
  for (const source of ['$n$', '$a_1, a_2, \\dots, a_n$']) {
    const result = await module.namespace.mountMarkdown(makeHost(), source);
    assert.equal(result.mathRendered, true);
    assert.equal(calls.at(-1), true, 'MathJax must not measure a detached page');
  }
  // A page abandoned before it mounts must keep plain TeX instead of producing invalid SVG metrics.
  attachOnFrame = false;
  const before = calls.length;
  const result = await module.namespace.mountMarkdown(makeHost(), '$q$');
  assert.equal(result.mathRendered, false);
  assert.equal(calls.length, before);
  console.log('PASS connected math rendering and abandoned page');
})().catch(error => { console.error(error); process.exitCode = 1; });
