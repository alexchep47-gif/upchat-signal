import { cleanText, enqueueMessage, fail, findDeviceByToken, guard } from './_store.js';

export default async function handler(req, res) {
  const auth = guard(req, res, 'message');
  if (!auth) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const sender = await findDeviceByToken(auth.tokenHash);
    if (!sender) return res.status(401).json({ error: 'Unauthorized' });
    const payload = req.body || {};
    const targetUserId = cleanText(payload.targetUserId, 128);
    const messageId = cleanText(payload.id || payload.messageId, 160);
    if (!targetUserId || !messageId) return res.status(400).json({ error: 'Invalid message envelope' });
    if (targetUserId === sender.userId) return res.status(400).json({ error: 'Invalid recipient' });
    const envelope = {
      id: messageId,
      targetUserId,
      senderUserId: sender.userId,
      ciphertext: typeof payload.ciphertext === 'string' ? payload.ciphertext.slice(0, 262144) : null,
      content: process.env.UPCHAT_REQUIRE_E2EE === 'true' ? undefined : cleanText(payload.content, 10000),
      type: cleanText(payload.type || 'text', 40),
      sentAt: new Date().toISOString(),
      security: process.env.UPCHAT_REQUIRE_E2EE === 'true' ? 'e2ee-required' : 'transport-only',
    };
    if (process.env.UPCHAT_REQUIRE_E2EE === 'true' && !envelope.ciphertext) {
      return res.status(422).json({ error: 'Encrypted envelope required' });
    }
    const result = await enqueueMessage({ messageId, targetUserId, senderUserId: sender.userId, envelope });
    return res.status(200).json({ ok: true, id: result.messageId, duplicate: !result.accepted });
  } catch (error) { return fail(res, error); }
}
