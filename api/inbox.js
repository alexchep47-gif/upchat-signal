import { getStore, cors } from './_store.js';

/** Récupère et vide l'inbox d'un utilisateur (poll). */
export default function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const userId = req.query?.userId;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const store = getStore();
  const messages = store.inbox.get(userId) || [];
  store.inbox.set(userId, []);

  return res.status(200).json({ messages });
}
