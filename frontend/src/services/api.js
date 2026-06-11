// Dev uses Vite proxy to :8000. Works same-origin in prod.
const API = '';

async function req(path, opts = {}) {
  const r = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: 'Connection error' }));
    throw new Error(e.detail || `HTTP ${r.status}`);
  }
  return r.json();
}

export const getHealth = () => req('/api/health');
export const startDeviceAuth = () => req('/api/auth/device/start', { method: 'POST' });
export const pollDeviceAuth = () => req('/api/auth/device/poll', { method: 'POST' });
export const submitViyaCode = (code) =>
  req('/api/auth/viya/code', { method: 'POST', body: JSON.stringify({ code }) });

// Extract text from an uploaded file (multipart — no JSON headers)
export const extractAttachment = async (file) => {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch(`${API}/api/extract`, { method: 'POST', body: fd });
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: 'Upload failed' }));
    throw new Error(e.detail || `HTTP ${r.status}`);
  }
  return r.json();
};
export const getAgents = () => req('/api/agents');
export const getCollections = () => req('/api/collections');
export const getSessions = () => req('/api/sessions');
export const getSessionQueries = (sessionId) =>
  req(`/api/sessions/${encodeURIComponent(sessionId)}/queries`);

// target: { type: 'agent', id } or { type: 'collection', id }
// attachments: [{ name, text }] — extracted documents inlined into the query
export const sendQuery = (content, target, querySessionId = null, attachments = null) =>
  req('/api/query', {
    method: 'POST',
    body: JSON.stringify({
      content,
      agentId: target.type === 'agent' ? target.id : null,
      collectionIds: target.type === 'collection' ? [target.id] : null,
      querySessionId,
      attachments,
    }),
  });
