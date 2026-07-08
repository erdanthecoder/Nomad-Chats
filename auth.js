const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const secretPath = path.join(__dirname, 'data', '.jwt-secret');
let JWT_SECRET;
if (process.env.JWT_SECRET) {
  JWT_SECRET = process.env.JWT_SECRET;
} else if (fs.existsSync(secretPath)) {
  JWT_SECRET = fs.readFileSync(secretPath, 'utf8');
} else {
  JWT_SECRET = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  fs.writeFileSync(secretPath, JWT_SECRET);
}

const COOKIE_NAME = 'nexchat_session';
const TOKEN_TTL_DAYS = 30;

function issueToken(userId) {
  return jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: `${TOKEN_TTL_DAYS}d` });
}

function setSessionCookie(res, userId) {
  const token = issueToken(userId);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Not authenticated' });
  req.userId = payload.uid;
  next();
}

module.exports = { COOKIE_NAME, setSessionCookie, clearSessionCookie, verifyToken, requireAuth };
