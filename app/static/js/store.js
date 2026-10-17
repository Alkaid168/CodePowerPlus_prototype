/* 全局状态只保留三样东西：当前学习者、服务状态、知识树缓存。 */
const STORAGE_KEY = 'codepowerplus:user';
const listeners = new Set();

function initialUser() {
  try { return localStorage.getItem(STORAGE_KEY) || 'demo-user'; }
  catch { return 'demo-user'; }
}

export const store = {
  state: {
    userId: initialUser(),
    health: null,
    knowledge: [],
    knowledgeTree: [],
    knowledgeVersion: '',
  },

  set(patch) {
    Object.assign(this.state, patch);
    for (const listener of listeners) listener(this.state);
  },

  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  setUser(userId) {
    const value = (userId || '').trim() || 'demo-user';
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* 存储禁用时仍保留当前页面内的学习者。 */ }
    this.set({ userId: value });
  },

  /** 知识树只需拉一次；树结构和版本都缓存在这里。 */
  async ensureKnowledge(api) {
    if (this.state.knowledge.length) return this.state.knowledge;
    const data = await api.knowledgeTree();
    const flat = [];
    const walk = (nodes) => nodes.forEach((node) => {
      flat.push(node);
      walk(node.children || []);
    });
    walk(data.tree);
    this.set({ knowledge: flat, knowledgeTree: data.tree, knowledgeVersion: data.version });
    return flat;
  },
};
