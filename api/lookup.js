import { cors, fail, findDeviceByToken, lookupFirebaseUserByPhone, lookupPhone, normalizePhone, guard, log } from './_store.js';

export default async function handler(req, res) {
  const auth = await guard(req, res, 'lookup');
  if (!auth) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const phone = normalizePhone(req.query?.phone || '');
    if (!phone) return res.status(400).json({ found: false, error: 'Invalid phone' });
    if (!auth.firebase && !await findDeviceByToken(auth.tokenHash)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const record = await lookupPhone(phone) || await lookupFirebaseUserByPhone(phone);
    if (!record) {
      log('info', 'lookup_miss', { phoneTail: phone.slice(-4) });
      return res.status(200).json({ found: false });
    }
    log('info', 'lookup_hit', { phoneTail: phone.slice(-4) });
    return res.status(200).json({
      found: true,
      userId: record.userId,
      name: record.name,
      phone: record.phone || phone,
      lastSeen: record.lastSeen,
    });
  } catch (error) { return fail(res, error); }
}
