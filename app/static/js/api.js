/* 后端接口封装：统一拼查询参数、统一解析 {"code","detail"} 错误。 */

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', body, params } = {}) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.detail === 'string' ? payload.detail : `请求失败（HTTP ${response.status}）`;
    throw new ApiError(message, response.status, payload.code);
  }
  return payload;
}

export const api = {
  health: () => request('/health'),
  overview: (userId) => request('/api/overview', { params: { user_id: userId } }),

  knowledgeTree: () => request('/api/knowledge/tree'),
  knowledgeSearch: (q, level) => request('/api/knowledge/search', { params: { q, level } }),
  knowledgeDetail: (id) => request(`/api/knowledge/node/${encodeURIComponent(id)}`),

  problems: (params) => request('/api/problems', { params }),
  problem: (id) => request(`/api/problems/${id}`),
  createProblem: (body) => request('/api/problems', { method: 'POST', body }),
  // 录入与分析是两步：先建题拿到 OJ 编号，再调用模型；模型失败时题目仍在，可以重试。
  analyzeProblem: (id) => request(`/api/problems/${id}/analyze`, { method: 'POST' }),
  saveAnalysis: (id, body) => request(`/api/problems/${id}/analyses`, { method: 'POST', body }),
  analysisHistory: (id) => request(`/api/problems/${id}/analyses`),

  reviewQueue: (status) => request('/api/reviews', { params: { status } }),
  reviewProblem: (id, body) => request(`/api/problems/${id}/review`, { method: 'POST', body }),
  reviewHistory: (id) => request(`/api/problems/${id}/reviews`),

  createSubmission: (body) => request('/api/submissions', { method: 'POST', body }),
  submissions: (params) => request('/api/submissions', { params }),

  profile: (userId) => request(`/api/users/${encodeURIComponent(userId)}/profile`),
  recommendations: (userId) => request(`/api/users/${encodeURIComponent(userId)}/recommendations`),
  learningPath: (userId, targetId) => request(`/api/users/${encodeURIComponent(userId)}/learning-path`,
    { params: { target_id: targetId } }),
  tutorHint: (body) => request('/api/tutor/hint', { method: 'POST', body }),
};
