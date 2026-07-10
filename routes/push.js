const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const { publicKey } = require('../push');

const router = express.Router();
router.use(requireAuth);

router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey });
});

router.post('/subscribe', (req, res) => {
  const { subscription } = req.body || {};
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
  ).run(subscription.endpoint, req.userId, subscription.keys.p256dh, subscription.keys.auth, Date.now());
  res.json({ ok: true });
});

router.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, req.userId);
  res.json({ ok: true });
});

module.exports = router;
