const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { setSessionCookie, clearSessionCookie, requireAuth } = require('../auth');

const router = express.Router();

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatarUrl: u.avatar_url,
    statusText: u.status_text,
    language: u.language,
    lastSeen: u.last_seen
  };
}

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,32}$/;

router.post('/register', (req, res) => {
  const { username, password, displayName } = req.body || {};
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'Username, password and display name are required' });
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-32 characters: letters, numbers, dot or underscore' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Username already taken' });

  const id = uuid();
  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  db.prepare(`INSERT INTO users (id, username, password_hash, display_name, avatar_url, language, last_seen, created_at)
              VALUES (?, ?, ?, ?, NULL, 'en', ?, ?)`)
    .run(id, username.toLowerCase(), hash, displayName.trim().slice(0, 60), now, now);

  setSessionCookie(res, id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), user.id);
  setSessionCookie(res, user.id);
  res.json({ user: publicUser(user) });
});

router.post('/logout', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), req.userId);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: publicUser(user) });
});

router.patch('/me', requireAuth, (req, res) => {
  const { displayName, statusText, language, avatarUrl } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const next = {
    display_name: displayName != null ? String(displayName).trim().slice(0, 60) || user.display_name : user.display_name,
    status_text: statusText != null ? String(statusText).trim().slice(0, 140) : user.status_text,
    language: language === 'ru' ? 'ru' : language === 'en' ? 'en' : user.language,
    avatar_url: avatarUrl != null ? avatarUrl : user.avatar_url
  };
  db.prepare('UPDATE users SET display_name=?, status_text=?, language=?, avatar_url=? WHERE id=?')
    .run(next.display_name, next.status_text, next.language, next.avatar_url, req.userId);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  res.json({ user: publicUser(updated) });
});

router.get('/users/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 1) return res.json({ users: [] });
  const rows = db.prepare(
    `SELECT * FROM users WHERE (username LIKE ? OR display_name LIKE ?) AND id != ? LIMIT 20`
  ).all(`%${q}%`, `%${q}%`, req.userId);
  res.json({ users: rows.map(publicUser) });
});

module.exports = { router, publicUser };
