// Picks the backend: server.mjs marks index.html with <meta name="vi-backend">; without it, the in-browser mock runs.
import * as local from './api.js';

const remote = document.querySelector('meta[name=vi-backend][content=server]') ? await import('./remote.js') : null;

export const mode = remote ? 'server' : 'browser';
// Pure helpers (geometry, assessment, journeys) always come from api.js; endpoints from the server when present.
export const api = remote ? { ...local, ...remote } : local;
