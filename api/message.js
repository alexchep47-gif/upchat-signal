import { getStore, cors } from './_store.js';

/**
 * Dépôt d'un message dans l'inbox du destinataire.
 * Le client pollera /api/inbox?userId=... (à brancher côté app plus tard).
 */
export default function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const payload = req.body || {};
  const targetUserId = payload.targetUserId;
  if (!targetUserId) {
    return res.status(400).json({ error: 'targetUserId required' });
  }

  const store = getStore();
  if (!store.inbox.has(targetUserId)) {
    store.inbox.set(targetUserId, []);
  }
  const box = store.inbox.get(targetUserId);
  box.push({ ...payload, receivedAt: new Date().toISOString() });
  // Garde les 200 derniers messages max par utilisateur
  if (box.length > 200) box.splice(0, box.length - 200);

  return res.status(200).json({ ok: true, id: payload.id });
}
