import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import register from './api/register.js';
import lookup from './api/lookup.js';
import presence from './api/presence.js';
import message from './api/message.js';
import inbox from './api/inbox.js';
import health from './api/health.js';
import { authenticateRelayToken, enqueueMessage, log } from './api/_store.js';

const app = express();
app.disable('x-powered-by');
app.use((_, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '300kb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    // Éviter de spammer les health checks trop verbeux : log seulement si lent ou erreur
    const ms = Date.now() - start;
    if (req.path === '/api/health' && res.statusCode < 400 && ms < 500) return;
    log('info', 'http', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms,
    });
  });
  next();
});

app.all('/api/register', register);
app.all('/api/lookup', lookup);
app.all('/api/presence', presence);
app.all('/api/message', message);
app.all('/api/inbox', inbox);
app.all('/api/health', health);
// Public probe kept for Render and older clients.
app.all('/health', health);
// Alias fréquent Render/load balancer
app.get('/health', health);

app.use((req, res) => {
  log('warn', 'not_found', { method: req.method, path: req.path });
  res.status(404).json({ error: 'Not found' });
});
app.use((error, _, res, next) => {
  if (error?.type === 'entity.parse.failed' || error instanceof SyntaxError) {
    log('warn', 'invalid_json');
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  return next(error);
});

const port = Number(process.env.PORT || 3000);
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  let session = null;
  const authTimer = setTimeout(() => socket.close(1008, 'Authentication required'), 8000);
  socket.on('message', async (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (!session) {
        if (message.type !== 'auth' || message.protocol !== 'upchat.relay.v1') {
          socket.close(1008, 'Authentication required');
          return;
        }
        session = await authenticateRelayToken(message.token);
        if (!session) {
          socket.close(1008, 'Unauthorized');
          return;
        }
        clearTimeout(authTimer);
        socket.send(JSON.stringify({ type: 'ready', protocol: 'upchat.relay.v1' }));
        return;
      }
      if (message.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (message.type !== 'relay' || typeof message.targetUserId !== 'string') return;
      const envelope = message.envelope;
      if (!envelope || typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > 200000) {
        socket.send(JSON.stringify({ type: 'error', code: 'opaque_envelope_required' }));
        return;
      }
      const messageId = String(envelope.messageId || `${session.userId}:${Date.now()}`);
      const stored = {
        id: messageId,
        messageId,
        protocol: 'upchat.relay.v1',
        ciphertext: envelope.ciphertext,
        senderKeyId: envelope.senderKeyId || null,
        createdAt: new Date().toISOString(),
      };
      await enqueueMessage({
        messageId,
        targetUserId: message.targetUserId,
        senderUserId: session.userId,
        envelope: stored,
      });
      socket.send(JSON.stringify({ type: 'accepted', messageId }));
    } catch (_) {
      socket.send(JSON.stringify({ type: 'error', code: 'invalid_message' }));
    }
  });
  socket.on('close', () => clearTimeout(authTimer));
});

server.listen(port, '0.0.0.0', () => {
  log('info', 'listening', {
    port,
    node: process.version,
    hasDatabase: Boolean(process.env.DATABASE_URL),
    memoryStore: process.env.UPCHAT_ALLOW_MEMORY_STORE === 'true',
  });
});
