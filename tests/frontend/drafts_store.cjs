const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
(async () => {
  async function load(storage) {
    const context = vm.createContext({localStorage: storage});
    const module = new vm.SourceTextModule(fs.readFileSync('app/static/js/store.js', 'utf8'), {context});
    await module.link(() => { throw Error('store should not add API dependencies'); });
    await assert.doesNotReject(() => module.evaluate(), 'blocked storage must not prevent app initialization');
    return module.namespace.store;
  }
  const blocked = {getItem() {throw Error('SecurityError');},setItem() {throw Error('QuotaExceededError');}};
  const fallback = await load(blocked);
  assert.equal(fallback.state.userId, 'demo-user');
  let observed = null;const unsubscribe = fallback.subscribe(state => {observed = state.userId;});
  assert.doesNotThrow(() => fallback.setUser('  alice  '));
  assert.equal(fallback.state.userId, 'alice');assert.equal(observed, 'alice', 'memory fallback still notifies views');
  fallback.setUser(' ');assert.equal(fallback.state.userId, 'demo-user');unsubscribe();
  const values = new Map([['codepowerplus:user', 'bob']]);
  const persisted = await load({getItem: key => values.get(key),setItem: (key,value) => values.set(key,value)});
  assert.equal(persisted.state.userId, 'bob');persisted.setUser('carol');assert.equal(values.get('codepowerplus:user'), 'carol');
  console.log('PASS store: blocked read initialization, quota failure memory fallback, subscriber notification and normal persistence');
})().catch(error => {console.error(error);process.exitCode = 1;});
