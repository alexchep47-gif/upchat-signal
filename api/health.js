import { cors, ensureSchema, fail, firebaseAuthMode, log } from './_store.js';

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const started = Date.now();
  try {
    const pg = await ensureSchema();
    const body = {
      ok: true,
      service: 'upchat-signal',
      storage: process.env.DATABASE_URL ? 'postgres' : 'memory',
      schemaReady: Boolean(pg),
      auth: firebaseAuthMode(),
      uptimeSec: Math.floor(process.uptime()),
      latencyMs: Date.now() - started,
    };
    log('info', 'health_ok', { storage: body.storage, auth: body.auth, latencyMs: body.latencyMs });
    return res.status(200).json(body);
  } catch (error) {
    log('error', 'health_failed', { name: error?.name, code: error?.code });
    return fail(res, error);
  }
}
