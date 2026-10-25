import { cors, fail, findDeviceByToken, guard, touchDevice } from './_store.js';

export default async function handler(req, res) {
  const auth = guard(req, res, 'presence');
  if (!auth) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const device = await findDeviceByToken(auth.tokenHash);
    if (!device) return res.status(401).json({ error: 'Unauthorized' });
    await touchDevice(device.userId);
    return res.status(200).json({ ok: true, lastSeen: new Date().toISOString() });
  } catch (error) { return fail(res, error); }
}
