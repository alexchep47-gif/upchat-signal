import express from 'express';
import register from './api/register.js';
import lookup from './api/lookup.js';
import presence from './api/presence.js';
import message from './api/message.js';
import inbox from './api/inbox.js';
import health from './api/health.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '300kb' }));

app.all('/api/register', register);
app.all('/api/lookup', lookup);
app.all('/api/presence', presence);
app.all('/api/message', message);
app.all('/api/inbox', inbox);
app.all('/api/health', health);

app.use((_, res) => res.status(404).json({ error: 'Not found' }));

const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => {
  console.log(`upchat-signal listening on ${port}`);
});
