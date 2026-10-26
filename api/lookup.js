import { cors, fail, findDeviceByToken, lookupPhone, normalizePhone, guard } from './_store.js';

export default async function handler(req, res) {
  const auth = await guard(req, res, 'lookup');
  if (!auth) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const phone = normalizePhone(req.query?.phone || '');
    if (!phone) return res.status(400).json({ found: false, error: 'Invalid phone' });
    if (!await findDeviceByToken(auth.tokenHash)) return res.status(401).json({ error: 'Unauthorized' });
    const record = await lookupPhone(phone);
    return res.status(200).json(record ? {
      found: true, userId: record.userId, name: record.name, lastSeen: record.lastSeen,
    } : { found: false });
  } catch (error) { return fail(res, error); }
}
