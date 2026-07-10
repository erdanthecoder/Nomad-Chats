const express = require('express');
const http = require('http');
const path = require('path');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const { v4: uuid } = require('uuid');

const db = require('./db');
const { verifyToken } = require('./auth');
const { router: authRouter, publicUser } = require('./routes/auth');
const { router: chatsRouter, conversationSummary, memberIds, isMember } = require('./routes/chats');
const uploadRouter = require('./routes/upload');
const pushRouter = require('./routes/push');
const { sendPushToUser } = require('./push');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, 'data', 'uploads'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));

app.use('/api/auth', authRouter);
app.use('/api', chatsRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/push', pushRouter);

app.get('/health', (req, res) => res.json({ ok: true }));

// ---- Socket.io: presence, realtime messaging, typing, WebRTC signaling ----

const onlineUsers = new Map(); // userId -> Set<socketId>

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  });
  return out;
}

io.use((socket, next) => {
  const cookies = parseCookies(socket.handshake.headers.cookie);
  const token = cookies['nexchat_session'];
  const payload = token && verifyToken(token);
  if (!payload) return next(new Error('unauthorized'));
  socket.userId = payload.uid;
  next();
});

function userConversationIds(userId) {
  return db.prepare('SELECT conversation_id FROM conversation_members WHERE user_id = ?')
    .all(userId).map(r => r.conversation_id);
}

function broadcastToConversation(conversationId, event, payload, excludeSocketId) {
  const ids = memberIds(conversationId);
  for (const uid of ids) {
    const sockets = onlineUsers.get(uid);
    if (!sockets) continue;
    for (const sid of sockets) {
      if (sid === excludeSocketId) continue;
      io.to(sid).emit(event, payload);
    }
  }
}

function emitToUser(userId, event, payload) {
  const sockets = onlineUsers.get(userId);
  if (!sockets) return false;
  for (const sid of sockets) io.to(sid).emit(event, payload);
  return sockets.size > 0;
}

io.on('connection', (socket) => {
  const { userId } = socket;
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  const wasOffline = onlineUsers.get(userId).size === 0;
  onlineUsers.get(userId).add(socket.id);

  for (const convId of userConversationIds(userId)) socket.join(convId);

  if (wasOffline) {
    db.prepare('UPDATE users SET last_seen = NULL WHERE id = ?').run(userId);
    for (const convId of userConversationIds(userId)) {
      broadcastToConversation(convId, 'presence:update', { userId, online: true }, socket.id);
    }
  }

  socket.on('conversation:typing', ({ conversationId, isTyping }) => {
    if (!isMember(conversationId, userId)) return;
    broadcastToConversation(conversationId, 'conversation:typing', { conversationId, userId, isTyping }, socket.id);
  });

  socket.on('message:send', (data, ack) => {
    try {
      const { conversationId, type, content, fileUrl, fileName } = data || {};
      if (!conversationId || !isMember(conversationId, userId)) {
        return ack && ack({ error: 'Not a member of this conversation' });
      }
      const validType = ['text', 'image', 'file'].includes(type) ? type : 'text';
      if (validType === 'text' && (!content || !String(content).trim())) {
        return ack && ack({ error: 'Empty message' });
      }
      const id = uuid();
      const now = Date.now();
      db.prepare(
        `INSERT INTO messages (id, conversation_id, sender_id, type, content, file_url, file_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, conversationId, userId, validType, content ? String(content).slice(0, 4000) : null, fileUrl || null, fileName || null, now);

      const message = {
        id, conversationId, senderId: userId, type: validType,
        content: content || null, fileUrl: fileUrl || null, fileName: fileName || null,
        createdAt: now
      };
      io.to(conversationId).emit('message:new', message);
      ack && ack({ message });

      const sender = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId);
      const preview = validType === 'text' ? String(content).slice(0, 120)
        : validType === 'image' ? 'Sent a photo'
        : `Sent a file: ${fileName || ''}`;
      for (const uid of memberIds(conversationId)) {
        if (uid === userId) continue;
        if (onlineUsers.has(uid)) continue; // already reachable live, skip push to avoid noise
        sendPushToUser(uid, {
          title: sender ? sender.display_name : 'New message',
          body: preview,
          tag: `msg-${conversationId}`,
          conversationId,
          isCall: false
        });
      }
    } catch (err) {
      ack && ack({ error: 'Failed to send message' });
    }
  });

  socket.on('message:read', ({ conversationId }) => {
    if (!conversationId || !isMember(conversationId, userId)) return;
    db.prepare('UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?')
      .run(Date.now(), conversationId, userId);
    broadcastToConversation(conversationId, 'message:read', { conversationId, userId }, socket.id);
  });

  socket.on('conversation:new', ({ conversationId, memberIds: ids }) => {
    const allIds = new Set([userId, ...(ids || [])]);
    for (const uid of allIds) {
      const sockets = onlineUsers.get(uid);
      if (!sockets) continue;
      for (const sid of sockets) io.sockets.sockets.get(sid)?.join(conversationId);
      if (uid !== userId) emitToUser(uid, 'conversation:invited', { conversationId });
    }
  });

  // ---- WebRTC call signaling ----
  socket.on('call:invite', ({ conversationId, callId, kind }) => {
    if (!isMember(conversationId, userId)) return;
    const caller = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const targets = memberIds(conversationId).filter(id => id !== userId);
    let anyOnline = false;
    for (const uid of targets) {
      const delivered = emitToUser(uid, 'call:incoming', {
        conversationId, callId, kind, from: publicUser(caller), targets
      });
      if (delivered) anyOnline = true;
      sendPushToUser(uid, {
        title: `${caller.display_name} is calling`,
        body: kind === 'video' ? 'Incoming video call' : 'Incoming voice call',
        tag: `call-${callId}`,
        conversationId,
        isCall: true
      });
    }
    if (!anyOnline) {
      emitToUser(userId, 'call:unavailable', { callId });
    }
  });

  socket.on('call:join', ({ callId, conversationId }) => {
    if (!isMember(conversationId, userId)) return;
    broadcastToConversation(conversationId, 'call:peer-joined', { callId, userId }, socket.id);
  });

  socket.on('call:announce', ({ callId, targetUserId }) => {
    emitToUser(targetUserId, 'call:peer-joined', { callId, userId });
  });

  socket.on('call:offer', ({ callId, targetUserId, sdp, conversationId, kind }) => {
    emitToUser(targetUserId, 'call:offer', { callId, fromUserId: userId, sdp, conversationId, kind });
  });

  socket.on('call:answer', ({ callId, targetUserId, sdp }) => {
    emitToUser(targetUserId, 'call:answer', { callId, fromUserId: userId, sdp });
  });

  socket.on('call:ice-candidate', ({ callId, targetUserId, candidate }) => {
    emitToUser(targetUserId, 'call:ice-candidate', { callId, fromUserId: userId, candidate });
  });

  socket.on('call:reject', ({ callId, targetUserId }) => {
    if (targetUserId) emitToUser(targetUserId, 'call:reject', { callId, fromUserId: userId });
  });

  socket.on('call:leave', ({ callId, conversationId }) => {
    if (conversationId) broadcastToConversation(conversationId, 'call:peer-left', { callId, userId }, socket.id);
  });

  socket.on('call:end', ({ callId, conversationId }) => {
    if (conversationId) {
      broadcastToConversation(conversationId, 'call:ended', { callId, byUserId: userId });
      const now = Date.now();
      const id = uuid();
      db.prepare(
        `INSERT INTO messages (id, conversation_id, sender_id, type, call_kind, call_status, created_at)
         VALUES (?, ?, ?, 'call', ?, 'ended', ?)`
      ).run(id, conversationId, userId, 'call', now);
      io.to(conversationId).emit('message:new', {
        id, conversationId, senderId: userId, type: 'call', callKind: 'call', callStatus: 'ended', createdAt: now
      });
    }
  });

  socket.on('disconnect', () => {
    const set = onlineUsers.get(userId);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) {
        onlineUsers.delete(userId);
        const now = Date.now();
        db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now, userId);
        for (const convId of userConversationIds(userId)) {
          broadcastToConversation(convId, 'presence:update', { userId, online: false, lastSeen: now });
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Nomad Chats server running on http://localhost:${PORT}`);
});
