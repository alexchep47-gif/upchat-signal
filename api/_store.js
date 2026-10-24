/**
 * Store en mémoire (process Vercel).
 * En production : remplacer par Vercel KV / Redis / Postgres.
 * Clés :
 *  - phone:{normalized} → { userId, name, lastSeen }
 *  - user:{userId} → { phone, name, lastSeen }
 *  - inbox:{userId} → [messages]
 */

globalThis.__upchatStore = globalThis.__upchatStore || {
  byPhone: new Map(),
  byUser: new Map(),
  inbox: new Map(),
};

export function getStore() {
  return globalThis.__upchatStore;
}

export function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits) return '';
  return hasPlus ? `+${digits}` : digits;
}

export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
