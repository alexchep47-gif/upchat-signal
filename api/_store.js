import crypto from 'node:crypto';
import pg from 'pg';
import admin from 'firebase-admin';

const { Pool } = pg;
const memory = globalThis.__upchatMemory || {
  devices: new Map(), byPhone: new Map(), inbox: new Map(), rate: new Map(),
};
globalThis.__upchatMemory = memory;
globalThis.__upchatPool = globalThis.__upchatPool || null;

let firebaseApp;
function firebaseAdminEnabled() {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}
function getFirebaseAdmin() {
  if (!firebaseAdminEnabled()) return null;
  if (firebaseApp) return firebaseApp;
  if (admin.apps.length) { firebaseApp = admin.app(); return firebaseApp; }
  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
  } else {
    credential = admin.credential.applicationDefault();
  }
  firebaseApp = admin.initializeApp({
    credential,
    projectId: process.env.FIREBASE_PROJECT_ID || undefined,
  });
  return firebaseApp;
}
export function firebaseAuthMode() {
  return firebaseAdminEnabled() ? 'firebase-admin' : 'legacy-device-token';
}
let schemaPromise;

export class StorageUnavailable extends Error {
  constructor(message = 'Storage unavailable') {
    super(message);
    this.name = 'StorageUnavailable';
  }
}

export function log(level, event, fields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: 'upchat-signal',
    event,
    ...fields,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

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
  globalThis.__upchatPool.on('error', (err) => {
    log('error', 'pg_pool_error', { name: err?.name, code: err?.code });
  });
  return globalThis.__upchatPool;
}

export async function ensureSchema() {
  const db = pool();
  if (!db) {
    if (process.env.UPCHAT_ALLOW_MEMORY_STORE === 'true') return false;
    throw new StorageUnavailable('DATABASE_URL missing and memory store disabled');
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
    `).catch((error) => {
      schemaPromise = undefined;
      log('error', 'schema_init_failed', { name: error?.name, code: error?.code });
      throw error;
    });
  }
  await schemaPromise;
  return true;
}

/** Canonique : +E.164 quand possible (Cameroun 6XXXXXXXX → +237…). */
export function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  let digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00') && digits.length > 4) digits = digits.slice(2);
  if (digits.length === 9 && digits.startsWith('6')) return `+237${digits}`;
  if (digits.length === 12 && digits.startsWith('237')) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  if (digits.length < 7 || digits.length > 15) return '';
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

/** Variantes pour retrouver un enregistrement saisi différemment. */
export function phoneCandidates(raw) {
  const primary = normalizePhone(raw);
  if (!primary) return [];
  const digits = primary.replace(/[^0-9]/g, '');
  const set = new Set([primary, digits, `+${digits}`]);
  if (digits.startsWith('237') && digits.length >= 12) {
    const local = digits.slice(3);
    set.add(local);
    set.add(`+237${local}`);
    set.add(`237${local}`);
  } else if (digits.length === 9 && digits.startsWith('6')) {
    set.add(`+237${digits}`);
    set.add(`237${digits}`);
  }
  return [...set].filter(Boolean);
}

export function allowedOrigins() {
  return (process.env.UPCHAT_ALLOWED_ORIGINS ||
      'https://upchat-web-pi.vercel.app,https://upchat-web-cmr-school.vercel.app,https://upchat-web.vercel.app,https://alexchep47-gif.github.io')
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
  const candidates = phoneCandidates(phone);
  if (!candidates.length) return null;

  if (await ensureSchema()) {
    const { rows } = await pool().query(
      `SELECT user_id AS "userId", name, phone, last_seen AS "lastSeen"
       FROM devices WHERE phone = ANY($1::text[]) LIMIT 1`,
      [candidates],
    );
    return rows[0] || null;
  }
  for (const c of candidates) {
    const record = memory.byPhone.get(c);
    if (record) {
      return { userId: record.userId, name: record.name, phone: record.phone, lastSeen: record.lastSeen };
    }
  }
  return null;
}

export async function lookupFirebaseUserByPhone(phone) {
  const firebase = getFirebaseAdmin();
  if (!firebase) return null;
  const candidates = phoneCandidates(phone).filter((c) => c.startsWith('+'));
  for (const candidate of candidates) {
    try {
      const user = await admin.auth(firebase).getUserByPhoneNumber(candidate);
      return {
        userId: user.uid,
        name: user.displayName || user.phoneNumber || candidate,
        phone: user.phoneNumber || candidate,
        lastSeen: user.metadata?.lastSignInTime || user.metadata?.creationTime || null,
      };
    } catch (error) {
      if (error?.code === 'auth/user-not-found') continue;
      throw error;
    }
  }
  return null;
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

export async function guard(req, res, key) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return false; }
  if (!rateLimit(req, key)) {
    log('warn', 'rate_limited', { route: key });
    res.status(429).json({ error: 'Too many requests' });
    return false;
  }
  const token = bearer(req);
  if (token.length < 32) {
    log('warn', 'unauthorized_short_token', { route: key });
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  const firebase = getFirebaseAdmin();
  if (firebase) {
    try {
      const decoded = await admin.auth(firebase).verifyIdToken(token);
      return { token, tokenHash: hashSecret(token), firebase: true, uid: decoded.uid, claims: decoded };
    } catch (error) {
      log('warn', 'firebase_token_rejected', { code: error?.code || error?.name });
      res.status(401).json({ error: 'Unauthorized' });
      return false;
    }
  }
  return { token, tokenHash: hashSecret(token), firebase: false };
}

export function fail(res, error) {
  if (error instanceof StorageUnavailable) {
    log('error', 'storage_unavailable', { message: error.message });
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }
  log('error', 'request_failed', {
    name: error?.name || 'Error',
    code: error?.code,
  });
  return res.status(500).json({ error: 'Internal server error' });
}
