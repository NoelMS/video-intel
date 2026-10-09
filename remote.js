// Client for server.mjs. Same signatures as the endpoint functions in api.js.
const j = async (path, { method = 'GET', body } = {}) => {
  // Every write is JSON, body or not: the server refuses a POST without a non-"simple" content type (CSRF guard).
  const r = await fetch('api/' + path, { method, headers: method === 'GET' ? {} : { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || `${method} /api/${path} failed (${r.status})`);
  return out;
};

export const getCameras = () => j('cameras');
export const videoEvents = id => j(`videos/${id}/events`);
export const getEvents = cameraId => j(cameraId ? `cameras/${cameraId}/events` : 'events');
export const getMemory = () => j('memory');
export const createMemory = r => j('memory', { method: 'POST', body: r });
export const updateMemory = (id, patch) => j('memory/' + id, { method: 'PUT', body: patch });
export const deleteMemory = id => j('memory/' + id, { method: 'DELETE' });
export const getHistory = () => j('history');
export const getSaved = () => j('saved');
export const saveEvidence = (eventId, query) => j('saved', { method: 'POST', body: { eventId, query } });
export const saveJourney = (track, query) => j('saved', { method: 'POST', body: { track, query } });
export const removeEvidence = id => j('saved/' + encodeURIComponent(id), { method: 'DELETE' });
export const moveItem = (id, lane, index) => j('saved/' + encodeURIComponent(id), { method: 'PUT', body: { lane, index } });
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

export const getSetup = () => j('setup');
export const installSetup = parts => j('setup/install', { method: 'POST', body: parts });
export const getDataset = () => j('dataset');
export const getVideos = () => j('videos');
export const deleteVideo = id => j('videos/' + id, { method: 'DELETE' });
export const reindexVideo = id => j('videos/' + id + '/reindex', { method: 'POST', body: {} });
// Upload with progress (fetch cannot report upload progress); metadata goes in the query string.
export const uploadVideo = (file, meta, onProgress) => new Promise((resolve, reject) => {
  const x = new XMLHttpRequest();
  x.open('POST', 'api/videos?' + new URLSearchParams({ ...meta, filename: file.name }));
  x.setRequestHeader('content-type', file.type.startsWith('video/') ? file.type : 'application/octet-stream');
  x.upload.onprogress = e => onProgress?.(e.loaded, e.total);
  x.onload = () => { const r = JSON.parse(x.responseText || '{}'); x.status < 300 ? resolve(r) : reject(new Error(r.error || `Upload failed (${x.status})`)); };
  x.onerror = () => reject(new Error('Upload failed: the local server did not answer'));
  x.send(file);
});
export const getIngest = () => j('ingest');
export const sourcesTfl = () => j('sources/tfl');
export const sourcesCaltrans = d => j('sources/caltrans/' + d);
export const sourcesMeva = prefix => j('sources/meva?prefix=' + encodeURIComponent(prefix));
export const addFeeds = items => j('feeds', { method: 'POST', body: { items } });
export const updateFeed = (id, patch) => j('feeds/' + id, { method: 'PUT', body: patch });
export const captureFeed = (id, clipSec) => j(`feeds/${id}/capture`, { method: 'POST', body: clipSec ? { clipSec } : {} });
export const pauseAllCapture = paused => j('capture', { method: 'PUT', body: { paused } });
export const evalAnswers = text => j('eval/answers?text=' + encodeURIComponent(text));
export const evalSummary = () => j('eval/summary');
export const baselineSearch = (text, k = 5) => j('baseline/search', { method: 'POST', body: { text, k } });
export const removeFeed = id => j('feeds/' + id, { method: 'DELETE' });
export const addImports = body => j('imports', { method: 'POST', body });
export const clearImports = () => j('imports', { method: 'DELETE' });
