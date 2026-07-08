const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../auth');
const { publicUser } = require('./auth');

const router = express.Router();
router.use(requireAuth);

function memberIds(conversationId) {
  return db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
    .all(conversationId).map(r => r.user_id);
}

function isMember(conversationId, userId) {
  return !!db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(conversationId, userId);
}

function conversationSummary(conv, userId) {
  const members = db.prepare(
    `SELECT u.* FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = ?`
  ).all(conv.id);
  const lastMessage = db.prepare(
    `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1`
  ).get(conv.id);
  const me = db.prepare('SELECT last_read_at FROM conversation_members WHERE conversation_id=? AND user_id=?')
    .get(conv.id, userId);
  const unreadCount = db.prepare(
    `SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND created_at > ? AND sender_id != ?`
  ).get(conv.id, me ? me.last_read_at : 0, userId).c;

  let title = conv.name;
  let avatarUrl = conv.avatar_url;
  let peer = null;
  if (conv.type === 'direct') {
    const other = members.find(m => m.id !== userId) || members[0];
    peer = publicUser(other);
    title = other ? other.display_name : 'Unknown';
    avatarUrl = other ? other.avatar_url : null;
  }

  return {
    id: conv.id,
    type: conv.type,
    name: title,
    avatarUrl,
    peer,
    members: members.map(publicUser),
    createdBy: conv.created_by,
    lastMessage: lastMessage ? {
      id: lastMessage.id,
      senderId: lastMessage.sender_id,
      type: lastMessage.type,
      content: lastMessage.content,
      fileName: lastMessage.file_name,
      createdAt: lastMessage.created_at
    } : null,
    unreadCount,
    updatedAt: lastMessage ? lastMessage.created_at : conv.created_at
  };
}

router.get('/conversations', (req, res) => {
  const rows = db.prepare(
    `SELECT c.* FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
     WHERE cm.user_id = ?`
  ).all(req.userId);
  const list = rows.map(c => conversationSummary(c, req.userId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  res.json({ conversations: list });
});

router.get('/conversations/:id', (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || !isMember(conv.id, req.userId)) return res.status(404).json({ error: 'Conversation not found' });
  res.json({ conversation: conversationSummary(conv, req.userId) });
});

router.post('/conversations/direct', (req, res) => {
  const { userId: otherId } = req.body || {};
  if (!otherId || otherId === req.userId) return res.status(400).json({ error: 'Invalid user' });
  const other = db.prepare('SELECT * FROM users WHERE id = ?').get(otherId);
  if (!other) return res.status(404).json({ error: 'User not found' });

  const existing = db.prepare(
    `SELECT c.* FROM conversations c
     JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
     JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
     WHERE c.type = 'direct'`
  ).get(req.userId, otherId);

  let conv = existing;
  if (!conv) {
    const id = uuid();
    const now = Date.now();
    db.prepare(`INSERT INTO conversations (id, type, name, avatar_url, created_by, created_at) VALUES (?, 'direct', NULL, NULL, ?, ?)`)
      .run(id, req.userId, now);
    db.prepare(`INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`)
      .run(id, req.userId, now);
    db.prepare(`INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`)
      .run(id, otherId, now);
    db.prepare(`INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)`).run(req.userId, otherId, now);
    db.prepare(`INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)`).run(otherId, req.userId, now);
    conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  }
  res.json({ conversation: conversationSummary(conv, req.userId) });
});

router.post('/conversations/group', (req, res) => {
  const { name, memberIds: ids, avatarUrl } = req.body || {};
  if (!name || !Array.isArray(ids) || ids.length < 1) {
    return res.status(400).json({ error: 'Group name and at least one member are required' });
  }
  const id = uuid();
  const now = Date.now();
  db.prepare(`INSERT INTO conversations (id, type, name, avatar_url, created_by, created_at) VALUES (?, 'group', ?, ?, ?, ?)`)
    .run(id, String(name).trim().slice(0, 60), avatarUrl || null, req.userId, now);
  db.prepare(`INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)`)
    .run(id, req.userId, now);
  const uniqueIds = [...new Set(ids.filter(uid => uid !== req.userId))];
  const insertMember = db.prepare(`INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`);
  for (const uid of uniqueIds) {
    if (db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid)) insertMember.run(id, uid, now);
  }
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  res.status(201).json({ conversation: conversationSummary(conv, req.userId) });
});

router.patch('/conversations/:id', (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || !isMember(conv.id, req.userId)) return res.status(404).json({ error: 'Conversation not found' });
  if (conv.type !== 'group') return res.status(400).json({ error: 'Only groups can be edited' });
  const role = db.prepare('SELECT role FROM conversation_members WHERE conversation_id=? AND user_id=?').get(conv.id, req.userId);
  if (!role || role.role !== 'admin') return res.status(403).json({ error: 'Only admins can edit this group' });
  const { name, avatarUrl } = req.body || {};
  db.prepare('UPDATE conversations SET name = COALESCE(?, name), avatar_url = COALESCE(?, avatar_url) WHERE id = ?')
    .run(name ? String(name).trim().slice(0, 60) : null, avatarUrl || null, conv.id);
  const updated = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conv.id);
  res.json({ conversation: conversationSummary(updated, req.userId) });
});

router.post('/conversations/:id/members', (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || !isMember(conv.id, req.userId)) return res.status(404).json({ error: 'Conversation not found' });
  if (conv.type !== 'group') return res.status(400).json({ error: 'Only groups support members' });
  const { userIds: ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'userIds required' });
  const now = Date.now();
  const insertMember = db.prepare(`INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`);
  for (const uid of ids) {
    if (db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid)) insertMember.run(conv.id, uid, now);
  }
  const updated = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conv.id);
  res.json({ conversation: conversationSummary(updated, req.userId) });
});

router.delete('/conversations/:id/members/:userId', (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || !isMember(conv.id, req.userId)) return res.status(404).json({ error: 'Conversation not found' });
  if (conv.type !== 'group') return res.status(400).json({ error: 'Only groups support members' });
  const targetId = req.params.userId;
  if (targetId !== req.userId) {
    const role = db.prepare('SELECT role FROM conversation_members WHERE conversation_id=? AND user_id=?').get(conv.id, req.userId);
    if (!role || role.role !== 'admin') return res.status(403).json({ error: 'Only admins can remove members' });
  }
  db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(conv.id, targetId);
  res.json({ ok: true });
});

router.get('/conversations/:id/messages', (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || !isMember(conv.id, req.userId)) return res.status(404).json({ error: 'Conversation not found' });
  const before = req.query.before ? Number(req.query.before) : Date.now() + 1;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const rows = db.prepare(
    `SELECT * FROM messages WHERE conversation_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?`
  ).all(conv.id, before, limit);
  rows.reverse();
  res.json({
    messages: rows.map(m => ({
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      type: m.type,
      content: m.content,
      fileUrl: m.file_url,
      fileName: m.file_name,
      callKind: m.call_kind,
      callStatus: m.call_status,
      createdAt: m.created_at
    }))
  });
});

router.post('/conversations/:id/read', (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || !isMember(conv.id, req.userId)) return res.status(404).json({ error: 'Conversation not found' });
  db.prepare('UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?')
    .run(Date.now(), conv.id, req.userId);
  res.json({ ok: true });
});

router.get('/contacts', (req, res) => {
  const rows = db.prepare(
    `SELECT u.* FROM contacts c JOIN users u ON u.id = c.contact_id WHERE c.user_id = ? ORDER BY u.display_name`
  ).all(req.userId);
  res.json({ contacts: rows.map(publicUser) });
});

router.post('/contacts', (req, res) => {
  const { userId: otherId } = req.body || {};
  const other = db.prepare('SELECT * FROM users WHERE id = ?').get(otherId);
  if (!other || otherId === req.userId) return res.status(404).json({ error: 'User not found' });
  const now = Date.now();
  db.prepare(`INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)`).run(req.userId, otherId, now);
  db.prepare(`INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)`).run(otherId, req.userId, now);
  res.json({ contact: publicUser(other) });
});

module.exports = { router, conversationSummary, memberIds, isMember };
