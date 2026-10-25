import { cleanText, deviceExists, enqueueMessage, fail, findDeviceByToken, guard } from './_store.js';

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
    if (!/^[A-Za-z0-9._:-]{8,160}$/.test(messageId)) {
      return res.status(400).json({ error: 'Invalid message id' });
    }
    if (!await deviceExists(targetUserId)) {
      return res.status(404).json({ error: 'Recipient not registered' });
    }
    const messageType = cleanText(payload.messageType || payload.type || 'text', 24);
    if (!/^(text|image|video|audio|file|system)$/.test(messageType)) {
      return res.status(400).json({ error: 'Invalid message type' });
    }
    const envelope = {
      version: 1,
      id: messageId,
      conversationId: cleanText(payload.conversationId || targetUserId, 160),
      targetUserId,
      senderUserId: sender.userId,
      senderId: sender.userId,
      senderName: sender.name,
      senderPhone: sender.phone,
      ciphertext: typeof payload.ciphertext === 'string' ? payload.ciphertext.slice(0, 262144) : null,
      content: process.env.UPCHAT_REQUIRE_E2EE === 'true' ? undefined : cleanText(payload.content, 10000),
      type: messageType,
      messageType,
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
