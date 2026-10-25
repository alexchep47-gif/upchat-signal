import { cors, ensureSchema, fail } from './_store.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await ensureSchema();
    return res.status(200).json({ ok: true, service: 'upchat-signal', storage: 'postgres' });
  } catch (error) {
    return fail(res, error);
  }
}
