import { cleanText, cors, fail, hashSecret, normalizePhone, rateLimit, registerDevice, guard } from './_store.js';

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await guard(req, res, 'register');
  if (!auth) return;
  try {
    const { userId, name, phone, deviceSecret } = req.body || {};
    if (auth.firebase) {
      if (userId !== auth.uid) return res.status(403).json({ error: 'User mismatch' });
    } else if (typeof deviceSecret !== 'string' || deviceSecret.length < 32 || auth.tokenHash !== hashSecret(deviceSecret)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (typeof userId !== 'string' || userId.length < 8 || userId.length > 128) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    const normalized = phone ? normalizePhone(phone) : null;
    if (phone && !normalized) return res.status(400).json({ error: 'Invalid phone' });
    const record = await registerDevice({
      userId,
      name: cleanText(name || 'Utilisateur', 80) || 'Utilisateur',
      phone: normalized,
      tokenHash: auth.tokenHash,
    });
    return res.status(200).json({ ok: true, userId: record.userId, lastSeen: record.lastSeen });
  } catch (error) {
    if (error?.code === '23505') {
      return res.status(409).json({ error: 'Phone number already registered' });
    }
    return fail(res, error);
  }
}
