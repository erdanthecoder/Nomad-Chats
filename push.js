const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const keyPath = path.join(__dirname, 'data', '.vapid-keys.json');

let keys;
if (fs.existsSync(keyPath)) {
  keys = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
} else {
  keys = webpush.generateVAPIDKeys();
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, JSON.stringify(keys));
}

webpush.setVapidDetails('mailto:admin@nomadchats.local', keys.publicKey, keys.privateKey);

const db = require('./db');

function sendPushToUser(userId, payload) {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  for (const sub of subs) {
    const pushSub = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth }
    };
    webpush.sendNotification(pushSub, JSON.stringify(payload)).catch((err) => {
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
      }
    });
  }
}

module.exports = { publicKey: keys.publicKey, sendPushToUser };
