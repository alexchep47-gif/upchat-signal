import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const memory = globalThis.__upchatMemory || {
  devices: new Map(), byPhone: new Map(), inbox: new Map(), rate: new Map(),
};
globalThis.__upchatMemory = memory;
globalThis.__upchatPool = globalThis.__upchatPool || null;
let schemaPromise;

export class StorageUnavailable extends Error {}

function pool() {
  if (globalThis.__upchatPool) return globalThis.__upchatPool;
  if (!process.env.DATABASE_URL) return null;
  globalThis.__upchatPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX || 5),
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });
  return globalThis.__upchatPool;
}

export async function ensureSchema() {
  const db = pool();
  if (!db) {
    if (process.env.UPCHAT_ALLOW_MEMORY_STORE === 'true') return false;
    throw new StorageUnavailable();
  }
  if (!schemaPromise) {
    schemaPromise = db.query(`
      CREATE TABLE IF NOT EXISTS devices (
        user_id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE,
        token_hash TEXT NOT NULL, last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS devices_phone_idx ON devices(phone);
      CREATE TABLE IF NOT EXISTS messages (
        message_id TEXT PRIMARY KEY,
        target_user_id TEXT NOT NULL REFERENCES devices(user_id) ON DELETE CASCADE,
        sender_user_id TEXT NOT NULL REFERENCES devices(user_id) ON DELETE CASCADE,
        envelope JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), delivered_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS messages_target_idx ON messages(target_user_id, created_at, message_id);
    `).catch((error) => { schemaPromise = undefined; throw error; });
  }
  await schemaPromise;
  return true;
}

export function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits || digits.length < 7 || digits.length > 15) return '';
  return hasPlus ? `+${digits}` : digits;
}

export function allowedOrigins() {
  return (process.env.UPCHAT_ALLOWED_ORIGINS ||
      'https://alexchep47-gif.github.io,https://upchat-web.vercel.app,https://upchat-cmr-school.vercel.app')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function cleanText(value, max = 200) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
}

export function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}

function bearer(req) {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

export function requireDevice(req) {
  const token = bearer(req);
  return token.length >= 32 ? { tokenHash: hashSecret(token) } : null;
}

export async function findDeviceByToken(tokenHash) {
  if (await ensureSchema()) {
    const { rows } = await pool().query(
      'SELECT user_id AS "userId", name, phone, last_seen AS "lastSeen", token_hash AS "tokenHash" FROM devices WHERE token_hash = $1 LIMIT 1',
      [tokenHash],
    );
    return rows[0] || null;
  }
  for (const record of memory.devices.values()) if (record.tokenHash === tokenHash) return record;
  return null;
}

export async function registerDevice({ userId, name, phone, tokenHash }) {
  if (await ensureSchema()) {
    const { rows } = await pool().query(
      `INSERT INTO devices(user_id, name, phone, token_hash, last_seen, updated_at)
       VALUES($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT(user_id) DO UPDATE SET name=EXCLUDED.name, phone=EXCLUDED.phone,
       token_hash=EXCLUDED.token_hash, last_seen=NOW(), updated_at=NOW()
       RETURNING user_id AS "userId", name, phone, last_seen AS "lastSeen"`,
      [userId, name, phone || null, tokenHash],
    );
    return rows[0];
  }
  const previous = memory.devices.get(userId);
  if (previous?.phone) memory.byPhone.delete(previous.phone);
  const record = { userId, name, phone: phone || null, tokenHash, lastSeen: new Date().toISOString() };
  memory.devices.set(userId, record);
  if (phone) memory.byPhone.set(phone, record);
  return record;
}

export async function touchDevice(userId) {
  if (await ensureSchema()) {
    await pool().query('UPDATE devices SET last_seen=NOW(), updated_at=NOW() WHERE user_id=$1', [userId]);
    return;
  }
  const record = memory.devices.get(userId);
  if (record) record.lastSeen = new Date().toISOString();
}

export async function lookupPhone(phone) {
  if (await ensureSchema()) {
    const { rows } = await pool().query(
      'SELECT user_id AS "userId", name, last_seen AS "lastSeen" FROM devices WHERE phone=$1 LIMIT 1',
      [phone],
    );
    return rows[0] || null;
  }
  const record = memory.byPhone.get(phone);
  return record ? { userId: record.userId, name: record.name, lastSeen: record.lastSeen } : null;
}

export async function deviceExists(userId) {
  if (await ensureSchema()) {
    const { rowCount } = await pool().query(
      'SELECT 1 FROM devices WHERE user_id=$1 LIMIT 1',
      [userId],
    );
    return rowCount > 0;
  }
  return memory.devices.has(userId);
}

export async function enqueueMessage({ messageId, targetUserId, senderUserId, envelope }) {
  if (await ensureSchema()) {
    const { rows } = await pool().query(
      `INSERT INTO messages(message_id,target_user_id,sender_user_id,envelope)
       VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(message_id) DO NOTHING
       RETURNING message_id AS "messageId"`,
      [messageId, targetUserId, senderUserId, JSON.stringify(envelope)],
    );
    return { accepted: rows.length > 0, messageId };
  }
  const box = memory.inbox.get(targetUserId) || [];
  if (box.some((item) => item.messageId === messageId)) return { accepted: false, messageId };
  box.push({ messageId, envelope }); memory.inbox.set(targetUserId, box.slice(-200));
  return { accepted: true, messageId };
}

export async function takeInbox(userId, limit = 100) {
  if (await ensureSchema()) {
    const client = await pool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT message_id AS "messageId", envelope FROM messages
         WHERE target_user_id=$1 AND delivered_at IS NULL ORDER BY created_at ASC
         LIMIT $2 FOR UPDATE SKIP LOCKED`, [userId, limit]);
      const ids = rows.map((row) => row.messageId);
      if (ids.length) await client.query('UPDATE messages SET delivered_at=NOW() WHERE message_id=ANY($1::text[])', [ids]);
      await client.query('COMMIT');
      return rows.map((row) => row.envelope);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  const entries = (memory.inbox.get(userId) || []).slice(0, limit);
  memory.inbox.set(userId, (memory.inbox.get(userId) || []).slice(entries.length));
  return entries.map((entry) => entry.envelope);
}

export function rateLimit(req, key, limit = 60, windowMs = 60_000) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const identity = `${key}:${forwarded || req.socket?.remoteAddress || 'unknown'}`;
  const now = Date.now();
  if (memory.rate.size > 10_000) {
    for (const [storedKey, value] of memory.rate) {
      if (value.reset <= now) memory.rate.delete(storedKey);
    }
  }
  const current = memory.rate.get(identity) || { count: 0, reset: now + windowMs };
  if (current.reset <= now) { current.count = 0; current.reset = now + windowMs; }
  current.count += 1; memory.rate.set(identity, current);
  return current.count <= limit;
}

export function cors(req, res) {
  const allowed = allowedOrigins();
  const origin = String(req.headers.origin || '').replace(/\/$/, '');
  res.setHeader('Vary', 'Origin');
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-UpChat-Client');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Cache-Control', 'no-store');
}

export function guard(req, res, key) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return false; }
  if (!rateLimit(req, key)) { res.status(429).json({ error: 'Too many requests' }); return false; }
  const auth = requireDevice(req);
  if (!auth) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return auth;
}

export function fail(res, error) {
  if (error instanceof StorageUnavailable) return res.status(503).json({ error: 'Service temporarily unavailable' });
  console.error('upchat-signal request failed', error?.name || 'Error');
  return res.status(500).json({ error: 'Internal server error' });
}
