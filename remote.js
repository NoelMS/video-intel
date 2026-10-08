// Client for server.mjs. Same signatures as the endpoint functions in api.js.
const j = async (path, { method = 'GET', body } = {}) => {
  const r = await fetch('api/' + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || `${method} /api/${path} failed (${r.status})`);
  return out;
};

export const getCameras = () => j('cameras');
export const getEvents = cameraId => j(cameraId ? `cameras/${cameraId}/events` : 'events');
export const getMemory = () => j('memory');
export const createMemory = r => j('memory', { method: 'POST', body: r });
export const updateMemory = (id, patch) => j('memory/' + id, { method: 'PUT', body: patch });
export const deleteMemory = id => j('memory/' + id, { method: 'DELETE' });
export const getHistory = () => j('history');
export const getSaved = () => j('saved');
export const saveEvidence = (eventId, query) => j('saved', { method: 'POST', body: { eventId, query } });
export const removeEvidence = id => j('saved/' + id, { method: 'DELETE' });
export const getNotes = async () => (await j('notes')).text;
export const setNotes = text => j('notes', { method: 'PUT', body: { text } });

// POST /search, then stream its stages over SSE.
export async function search(text, { onStage = () => {}, signal, ...opts } = {}) {
  const { id } = await j('search', { method: 'POST', body: { text, ...opts } });
  return new Promise((resolve, reject) => {
    const es = new EventSource(`api/search/${id}/events`);
    signal?.addEventListener('abort', () => {
      es.close(); fetch(`api/search/${id}`, { method: 'DELETE' });
      reject(new DOMException('Search cancelled', 'AbortError'));
    }, { once: true });
    es.addEventListener('stage', e => onStage(JSON.parse(e.data)));
    es.addEventListener('result', e => { es.close(); resolve(JSON.parse(e.data)); });
    es.addEventListener('fail', e => { es.close(); reject(new Error(JSON.parse(e.data).message)); });
    es.addEventListener('cancelled', () => { es.close(); reject(new DOMException('Search cancelled', 'AbortError')); });
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) return; es.close(); reject(new Error('Lost connection to the search service. Your query is preserved.')); };
  });
}
export const getSettings = () => j('settings');
export const setSettings = patch => j('settings', { method: 'PUT', body: patch });
export const getAudit = () => j('audit');
export const addAudit = entry => j('audit', { method: 'POST', body: entry });
export const getWatches = () => j('watches');
export const createWatch = w => j('watches', { method: 'POST', body: w });
export const updateWatch = (id, patch) => j('watches/' + id, { method: 'PUT', body: patch });
export const deleteWatch = id => j('watches/' + id, { method: 'DELETE' });
export const getAlerts = () => j('alerts');

// GET /live streams the server-side replay (tick, event, alert, end).
export function live({ speed = 60, from, onTick = () => {}, onEvent = () => {}, onAlert = () => {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`api/live?speed=${speed}${from ? '&from=' + from : ''}`);
    signal?.addEventListener('abort', () => { es.close(); reject(new DOMException('Live stopped', 'AbortError')); }, { once: true });
    es.addEventListener('tick', e => onTick(JSON.parse(e.data)));
    es.addEventListener('event', e => onEvent(JSON.parse(e.data)));
    es.addEventListener('alert', e => onAlert(JSON.parse(e.data)));
    es.addEventListener('end', () => { es.close(); resolve(); });
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) return; es.close(); reject(new Error('Live stream disconnected')); };
  });
}
