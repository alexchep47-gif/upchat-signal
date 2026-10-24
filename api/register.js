import { getStore, normalizePhone, cors } from './_store.js';

export default function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, name, phone } = req.body || {};
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId required' });
  }

  const store = getStore();
  const now = new Date().toISOString();
  const normalized = phone ? normalizePhone(phone) : null;

  // Nettoie ancien mapping téléphone si changé
  const prev = store.byUser.get(userId);
  if (prev?.phone && prev.phone !== normalized) {
    store.byPhone.delete(prev.phone);
  }

  const record = {
    userId,
    name: name || 'Utilisateur',
    phone: normalized || null,
    lastSeen: now,
  };

  store.byUser.set(userId, record);
  if (normalized) {
    store.byPhone.set(normalized, record);
  }

  return res.status(200).json({ ok: true, userId, phone: normalized, lastSeen: now });
}
