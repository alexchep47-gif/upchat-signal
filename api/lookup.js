import { getStore, normalizePhone, cors } from './_store.js';

export default function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const phone = normalizePhone(req.query?.phone || '');
  if (!phone) {
    return res.status(400).json({ found: false, error: 'phone required' });
  }

  const store = getStore();
  const record = store.byPhone.get(phone);

  if (!record) {
    return res.status(200).json({ found: false });
  }

  return res.status(200).json({
    found: true,
    userId: record.userId,
    name: record.name,
    phone: record.phone,
    lastSeen: record.lastSeen,
  });
}
