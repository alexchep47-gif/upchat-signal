import { getStore, normalizePhone, cors } from './_store.js';

export default function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, phone } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const store = getStore();
  const now = new Date().toISOString();
  const existing = store.byUser.get(userId) || {};
  const normalized = phone ? normalizePhone(phone) : existing.phone || null;

  const record = {
    userId,
    name: existing.name || 'Utilisateur',
    phone: normalized,
    lastSeen: now,
  };

  store.byUser.set(userId, record);
  if (normalized) store.byPhone.set(normalized, record);

  return res.status(200).json({ ok: true, lastSeen: now });
}
