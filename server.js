import express from 'express';
import register from './api/register.js';
import lookup from './api/lookup.js';
import presence from './api/presence.js';
import message from './api/message.js';
import inbox from './api/inbox.js';
import health from './api/health.js';

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

app.all('/api/register', register);
app.all('/api/lookup', lookup);
app.all('/api/presence', presence);
app.all('/api/message', message);
app.all('/api/inbox', inbox);
app.all('/api/health', health);

app.use((_, res) => res.status(404).json({ error: 'Not found' }));
app.use((error, _, res, next) => {
  if (error?.type === 'entity.parse.failed' || error instanceof SyntaxError) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  return next(error);
});

const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => {
  console.log(`upchat-signal listening on ${port}`);
});
