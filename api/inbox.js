import { fail, findDeviceByToken, guard, takeInbox } from './_store.js';

export default async function handler(req, res) {
  const auth = await guard(req, res, 'inbox');
  if (!auth) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const device = await findDeviceByToken(auth.tokenHash);
    if (!device) return res.status(401).json({ error: 'Unauthorized' });
    const requested = Number(req.query?.limit || 100);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 100) : 100;
    return res.status(200).json({ messages: await takeInbox(device.userId, limit) });
  } catch (error) { return fail(res, error); }
}
