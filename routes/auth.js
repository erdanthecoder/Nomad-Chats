const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { setSessionCookie, clearSessionCookie, requireAuth } = require('../auth');
const { sendResetCodeEmail } = require('../mailer');
const { ensureBotConversation } = require('../bot');

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
    lastSeen: u.last_seen,
    isBot: !!u.is_bot
  };
}

// Includes email — only ever returned for the authenticated user's own account,
// never attached to another user's public profile (search results, group
// members, conversation peers all go through publicUser above instead).
function meUser(u) {
  if (!u) return null;
  return { ...publicUser(u), email: u.email || null };
}

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', (req, res) => {
  const { username, password, displayName, email } = req.body || {};
  if (!username || !password || !displayName || !email) {
    return res.status(400).json({ error: 'Username, email, password and display name are required' });
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-32 characters: letters, numbers, dot or underscore' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const existingUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
  if (existingUsername) return res.status(409).json({ error: 'Username already taken' });
  const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existingEmail) return res.status(409).json({ error: 'An account with this email already exists' });

  const id = uuid();
  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  db.prepare(`INSERT INTO users (id, username, password_hash, display_name, email, avatar_url, language, last_seen, created_at)
              VALUES (?, ?, ?, ?, ?, NULL, 'en', ?, ?)`)
    .run(id, username.toLowerCase(), hash, displayName.trim().slice(0, 60), normalizedEmail, now, now);
  ensureBotConversation(id);

  setSessionCookie(res, id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ user: meUser(user) });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), user.id);
  ensureBotConversation(user.id);
  setSessionCookie(res, user.id);
  res.json({ user: meUser(user) });
});

router.post('/logout', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), req.userId);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  ensureBotConversation(user.id);
  res.json({ user: meUser(user) });
});

router.patch('/me', requireAuth, (req, res) => {
  const { displayName, statusText, language, avatarUrl, email } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  let nextEmail = user.email;
  if (email != null) {
    const normalizedEmail = String(email).trim().toLowerCase();
    if (normalizedEmail) {
      if (!EMAIL_RE.test(normalizedEmail)) return res.status(400).json({ error: 'Enter a valid email address' });
      const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(normalizedEmail, req.userId);
      if (taken) return res.status(409).json({ error: 'An account with this email already exists' });
      nextEmail = normalizedEmail;
    } else {
      nextEmail = null;
    }
  }

  const next = {
    display_name: displayName != null ? String(displayName).trim().slice(0, 60) || user.display_name : user.display_name,
    status_text: statusText != null ? String(statusText).trim().slice(0, 140) : user.status_text,
    language: language === 'ru' ? 'ru' : language === 'en' ? 'en' : user.language,
    avatar_url: avatarUrl != null ? avatarUrl : user.avatar_url,
    email: nextEmail
  };
  db.prepare('UPDATE users SET display_name=?, status_text=?, language=?, avatar_url=?, email=? WHERE id=?')
    .run(next.display_name, next.status_text, next.language, next.avatar_url, next.email, req.userId);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  res.json({ user: meUser(updated) });
});

router.get('/users/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 1) return res.json({ users: [] });
  const rows = db.prepare(
    `SELECT * FROM users WHERE (username LIKE ? OR display_name LIKE ?) AND id != ? AND is_bot = 0 LIMIT 20`
  ).all(`%${q}%`, `%${q}%`, req.userId);
  res.json({ users: rows.map(publicUser) });
});

// ---------------- Forgot password ----------------

const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const lastRequestByEmail = new Map();

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

router.post('/password-reset/request', async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });

  const cooldownUntil = lastRequestByEmail.get(email);
  if (cooldownUntil && Date.now() < cooldownUntil) {
    return res.status(429).json({ error: 'Please wait a bit before requesting another code' });
  }
  lastRequestByEmail.set(email, Date.now() + RESEND_COOLDOWN_MS);

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // Always respond the same way whether or not the account exists, so this
  // endpoint can't be used to discover which emails are registered.
  if (user) {
    const code = generateCode();
    const now = Date.now();
    db.prepare(
      `INSERT INTO password_resets (id, user_id, code_hash, expires_at, used, attempts, created_at)
       VALUES (?, ?, ?, ?, 0, 0, ?)`
    ).run(uuid(), user.id, hashCode(code), now + CODE_TTL_MS, now);
    try {
      await sendResetCodeEmail(email, code);
    } catch (err) {
      // Swallow delivery errors from the caller's perspective (same generic
      // response either way) but log server-side for diagnosis.
      console.error('Failed to send reset email:', err.message);
    }
  }
  res.json({ ok: true });
});

function findValidReset(email, code) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return { error: 'Invalid or expired code' };
  const reset = db.prepare(
    `SELECT * FROM password_resets WHERE user_id = ? AND used = 0 ORDER BY created_at DESC LIMIT 1`
  ).get(user.id);
  if (!reset || reset.expires_at < Date.now()) return { error: 'Invalid or expired code' };
  if (reset.attempts >= MAX_ATTEMPTS) return { error: 'Too many attempts. Request a new code.' };
  if (reset.code_hash !== hashCode(code)) {
    db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?').run(reset.id);
    return { error: 'Invalid or expired code' };
  }
  return { user, reset };
}

router.post('/password-reset/verify', (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const code = String((req.body || {}).code || '').trim();
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid or expired code' });
  }
  const result = findValidReset(email, code);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

router.post('/password-reset/confirm', (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const code = String((req.body || {}).code || '').trim();
  const { newPassword } = req.body || {};
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid or expired code' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const result = findValidReset(email, code);
  if (result.error) return res.status(400).json({ error: result.error });

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, result.user.id);
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(result.reset.id);
  res.json({ ok: true });
});

module.exports = { router, publicUser };
