// Picks the backend: server.mjs when it answers /api/health, else the in-browser mock.
import * as local from './api.js';

let remote = null;
try {
  const r = await fetch('api/health', { cache: 'no-store' });
  if (r.ok && (await r.json()).ok) remote = await import('./remote.js');
} catch {}

export const mode = remote ? 'server' : 'browser';
// Pure helpers (geometry, assessment, journeys) always come from api.js; endpoints from the server when present.
export const api = remote ? { ...local, ...remote } : local;
