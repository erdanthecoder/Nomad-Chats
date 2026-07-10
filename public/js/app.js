let me = null;
let socket = null;
let conversations = [];
let activeConversationId = null;
let messagesCache = {}; // conversationId -> [messages]
let typingTimeout = null;
let selectedGroupMembers = new Map(); // userId -> user
let onlineStatus = {}; // userId -> {online, lastSeen}

const $ = (sel) => document.querySelector(sel);
const $all = (sel) => document.querySelectorAll(sel);

function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
}

function avatarSvg(name, seed) {
  const colors = ['#00a884', '#128c7e', '#25d366', '#34b7f1', '#8696a0', '#f15c6d', '#ffb648', '#7c6ff0'];
  let hash = 0;
  const str = seed || name || '?';
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const color = colors[Math.abs(hash) % colors.length];
  const label = initials(name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${color}"/><text x="50" y="65" font-size="38" text-anchor="middle" fill="white" font-family="sans-serif" font-weight="600">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function avatarUrl(user) {
  if (!user) return avatarSvg('?', '?');
  return user.avatarUrl || avatarSvg(user.displayName || user.name, user.id || user.username);
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString(currentLang === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDay(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return formatTime(ts);
  if (d.toDateString() === yest.toDateString()) return t('yesterday');
  return d.toLocaleDateString(currentLang === 'ru' ? 'ru-RU' : 'en-US', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function showModal(id) { $(id).classList.remove('hidden'); }
function hideModal(id) { $(id).classList.add('hidden'); }

$all('[data-close-modal]').forEach(btn => {
  btn.addEventListener('click', () => btn.closest('.modal').classList.add('hidden'));
});

// ---------------- BOOTSTRAP ----------------

async function bootstrap() {
  renderIcons();
  renderLogos();
  applyI18n();
  try {
    const { user } = await API.me();
    me = user;
    setLang(me.language || currentLang);
    await enterApp();
  } catch {
    showAuthScreen();
  }
}

function showAuthScreen() {
  $('#auth-screen').classList.remove('hidden');
  $('#app-screen').classList.add('hidden');
}

async function enterApp() {
  $('#auth-screen').classList.add('hidden');
  $('#app-screen').classList.remove('hidden');
  $('#my-avatar').src = avatarUrl(me);
  connectSocket();
  await loadConversations();
  Push.init();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'notification-click' && event.data.conversationId) {
      openConversation(event.data.conversationId);
    }
  });
}

// ---------------- AUTH ----------------

$('#tab-login').addEventListener('click', () => {
  $('#tab-login').classList.add('active');
  $('#tab-register').classList.remove('active');
  $('#login-form').classList.remove('hidden');
  $('#register-form').classList.add('hidden');
});
$('#tab-register').addEventListener('click', () => {
  $('#tab-register').classList.add('active');
  $('#tab-login').classList.remove('active');
  $('#register-form').classList.remove('hidden');
  $('#login-form').classList.add('hidden');
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    const { user } = await API.login({
      username: $('#login-username').value.trim(),
      password: $('#login-password').value
    });
    me = user;
    setLang(me.language || currentLang);
    await enterApp();
  } catch (err) {
    $('#login-error').textContent = err.status === 401 ? t('invalid_credentials') : t('error_generic');
  }
});

$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#register-error').textContent = '';
  try {
    const { user } = await API.register({
      displayName: $('#register-displayname').value.trim(),
      username: $('#register-username').value.trim(),
      password: $('#register-password').value
    });
    me = user;
    setLang(me.language || currentLang);
    await enterApp();
  } catch (err) {
    $('#register-error').textContent = err.status === 409 ? t('username_taken') : (err.message || t('error_generic'));
  }
});

$('#btn-logout').addEventListener('click', async () => {
  try { await API.logout(); } catch {}
  if (socket) socket.disconnect();
  me = null;
  conversations = [];
  activeConversationId = null;
  messagesCache = {};
  hideModal('#modal-profile');
  location.reload();
});

// ---------------- SOCKET ----------------

function connectSocket() {
  socket = io({ withCredentials: true });

  socket.on('message:new', (msg) => {
    if (!messagesCache[msg.conversationId]) messagesCache[msg.conversationId] = [];
    messagesCache[msg.conversationId].push(msg);
    if (msg.conversationId === activeConversationId) {
      renderMessages(msg.conversationId);
      socket.emit('message:read', { conversationId: msg.conversationId });
    }
    bumpConversationPreview(msg);
  });

  socket.on('conversation:invited', () => loadConversations());

  socket.on('conversation:typing', ({ conversationId, userId, isTyping }) => {
    if (conversationId !== activeConversationId || userId === me.id) return;
    $('#chat-subtitle').textContent = isTyping ? t('typing') : subtitleFor(getConversation(conversationId));
  });

  socket.on('presence:update', ({ userId, online, lastSeen }) => {
    onlineStatus[userId] = { online, lastSeen };
    renderChatList();
    const conv = getConversation(activeConversationId);
    if (conv && conv.type === 'direct' && conv.peer && conv.peer.id === userId) {
      $('#chat-subtitle').textContent = subtitleFor(conv);
    }
  });

  socket.on('message:read', () => {});

  initCallHandlers();
}

// ---------------- CONVERSATIONS ----------------

async function loadConversations() {
  const { conversations: list } = await API.conversations();
  conversations = list;
  renderChatList();
  if (activeConversationId) openConversation(activeConversationId);
}

function getConversation(id) {
  return conversations.find(c => c.id === id);
}

function bumpConversationPreview(msg) {
  const conv = getConversation(msg.conversationId);
  if (conv) {
    conv.lastMessage = msg;
    conv.updatedAt = msg.createdAt;
    if (msg.conversationId !== activeConversationId && msg.senderId !== me.id) conv.unreadCount = (conv.unreadCount || 0) + 1;
  } else {
    loadConversations();
    return;
  }
  renderChatList();
}

function subtitleFor(conv) {
  if (!conv) return '';
  if (conv.type === 'group') return `${conv.members.length} ${conv.members.length === 1 ? t('member') : t('members')}`;
  const status = onlineStatus[conv.peer?.id];
  if (status && status.online) return t('online');
  const lastSeen = status?.lastSeen || conv.peer?.lastSeen;
  if (lastSeen) return `${t('last_seen')} ${formatDay(lastSeen)}`;
  return t('offline');
}

function renderChatList() {
  const q = ($('#chat-search').value || '').toLowerCase();
  const list = $('#chat-list');
  list.innerHTML = '';
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const conv of sorted) {
    if (q && !conv.name.toLowerCase().includes(q)) continue;
    const item = document.createElement('div');
    item.className = 'chat-item' + (conv.id === activeConversationId ? ' active' : '');
    const preview = conv.lastMessage
      ? (conv.lastMessage.type === 'text' ? escapeHtml(conv.lastMessage.content)
        : conv.lastMessage.type === 'image' ? `${iconSvg('image', 14, 'preview-icon')} ${t('image')}`
        : conv.lastMessage.type === 'call' ? `${iconSvg('phone', 14, 'preview-icon')} ${t('call_ended')}`
        : `${iconSvg('file', 14, 'preview-icon')} ${escapeHtml(conv.lastMessage.fileName || t('file'))}`)
      : '';
    const online = conv.type === 'direct' && onlineStatus[conv.peer?.id]?.online;
    item.innerHTML = `
      <div class="chat-item-avatar">
        <img class="avatar" src="${avatarUrl({ displayName: conv.name, avatarUrl: conv.avatarUrl, id: conv.id })}">
        ${online ? '<span class="online-dot"></span>' : ''}
      </div>
      <div class="chat-item-body">
        <div class="chat-item-top"><span class="chat-item-name">${escapeHtml(conv.name)}</span><span class="chat-item-time">${conv.lastMessage ? formatDay(conv.lastMessage.createdAt) : ''}</span></div>
        <div class="chat-item-bottom"><span class="chat-item-preview">${preview}</span>${conv.unreadCount ? `<span class="unread-badge">${conv.unreadCount}</span>` : ''}</div>
      </div>`;
    item.addEventListener('click', () => openConversation(conv.id));
    list.appendChild(item);
  }
}

$('#chat-search').addEventListener('input', renderChatList);

async function openConversation(id) {
  activeConversationId = id;
  const conv = getConversation(id);
  if (!conv) return;
  $('#empty-state').classList.add('hidden');
  $('#chat-view').classList.remove('hidden');
  $('#chat-avatar').src = avatarUrl({ displayName: conv.name, avatarUrl: conv.avatarUrl, id: conv.id });
  $('#chat-title').textContent = conv.name;
  $('#chat-subtitle').textContent = subtitleFor(conv);
  conv.unreadCount = 0;
  renderChatList();

  if (!messagesCache[id]) {
    const { messages } = await API.messages(id);
    messagesCache[id] = messages;
  }
  renderMessages(id);
  socket.emit('message:read', { conversationId: id });
  API.markRead(id).catch(() => {});
  $('#info-panel').classList.add('hidden');
}

function renderMessages(conversationId) {
  if (conversationId !== activeConversationId) return;
  const conv = getConversation(conversationId);
  const box = $('#messages');
  box.innerHTML = '';
  let lastDay = null;
  for (const msg of (messagesCache[conversationId] || [])) {
    const day = new Date(msg.createdAt).toDateString();
    if (day !== lastDay) {
      lastDay = day;
      const sep = document.createElement('div');
      sep.className = 'day-separator';
      sep.innerHTML = `<span>${formatDay(msg.createdAt).match(/:/) ? new Date(msg.createdAt).toLocaleDateString(currentLang === 'ru' ? 'ru-RU' : 'en-US', { day: '2-digit', month: 'long', year: 'numeric' }) : formatDay(msg.createdAt)}</span>`;
      box.appendChild(sep);
    }
    box.appendChild(renderMessageBubble(msg, conv));
  }
  box.scrollTop = box.scrollHeight;
}

function renderMessageBubble(msg, conv) {
  const mine = msg.senderId === me.id;
  const el = document.createElement('div');
  el.className = 'bubble-row' + (mine ? ' mine' : '');

  if (msg.type === 'call') {
    el.className = 'call-log-row';
    el.innerHTML = `<div class="call-log">${iconSvg('phone', 14, 'preview-icon')} ${t('call_ended')} · ${formatTime(msg.createdAt)}</div>`;
    return el;
  }

  const sender = conv?.members?.find(m => m.id === msg.senderId);
  const showName = conv?.type === 'group' && !mine;
  let inner = '';
  if (showName) inner += `<div class="bubble-sender">${escapeHtml(sender?.displayName || '')}</div>`;
  if (msg.type === 'image') {
    inner += `<a href="${msg.fileUrl}" target="_blank"><img class="bubble-image" src="${msg.fileUrl}" alt=""></a>`;
  } else if (msg.type === 'file') {
    inner += `<a class="bubble-file" href="${msg.fileUrl}" target="_blank" download>${iconSvg('paperclip', 16, 'preview-icon')} ${escapeHtml(msg.fileName || t('file'))}</a>`;
  } else {
    inner += `<div class="bubble-text">${escapeHtml(msg.content)}</div>`;
  }
  inner += `<div class="bubble-time">${formatTime(msg.createdAt)}</div>`;

  el.innerHTML = `<div class="bubble">${inner}</div>`;
  return el;
}

// ---------------- COMPOSER ----------------

$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#message-input');
  const text = input.value.trim();
  if (!text || !activeConversationId) return;
  socket.emit('message:send', { conversationId: activeConversationId, type: 'text', content: text }, (resp) => {
    if (resp?.error) alert(resp.error);
  });
  input.value = '';
  socket.emit('conversation:typing', { conversationId: activeConversationId, isTyping: false });
});

$('#message-input').addEventListener('input', () => {
  if (!activeConversationId) return;
  socket.emit('conversation:typing', { conversationId: activeConversationId, isTyping: true });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('conversation:typing', { conversationId: activeConversationId, isTyping: false });
  }, 1500);
});

$('#btn-attach').addEventListener('click', () => $('#file-input').click());

$('#file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !activeConversationId) return;
  try {
    const { url, fileName, isImage } = await API.upload(file);
    socket.emit('message:send', {
      conversationId: activeConversationId,
      type: isImage ? 'image' : 'file',
      fileUrl: url,
      fileName
    }, (resp) => { if (resp?.error) alert(resp.error); });
  } catch (err) {
    alert(err.message || t('error_generic'));
  }
  e.target.value = '';
});

// ---------------- NEW CHAT ----------------

$('#btn-new-chat').addEventListener('click', () => {
  $('#new-chat-search').value = '';
  $('#new-chat-results').innerHTML = '';
  showModal('#modal-new-chat');
});

let newChatDebounce = null;
$('#new-chat-search').addEventListener('input', () => {
  clearTimeout(newChatDebounce);
  newChatDebounce = setTimeout(async () => {
    const q = $('#new-chat-search').value.trim();
    const results = $('#new-chat-results');
    if (!q) { results.innerHTML = ''; return; }
    const { users } = await API.searchUsers(q);
    results.innerHTML = '';
    if (!users.length) { results.innerHTML = `<div class="no-results">${t('no_results')}</div>`; return; }
    for (const u of users) {
      const row = document.createElement('div');
      row.className = 'user-row';
      row.innerHTML = `<img class="avatar avatar-sm" src="${avatarUrl(u)}"><div><div class="user-row-name">${escapeHtml(u.displayName)}</div><div class="user-row-sub">@${escapeHtml(u.username)}</div></div>`;
      row.addEventListener('click', async () => {
        const { conversation } = await API.createDirect(u.id);
        socket.emit('conversation:new', { conversationId: conversation.id, memberIds: [u.id] });
        hideModal('#modal-new-chat');
        await loadConversations();
        openConversation(conversation.id);
      });
      results.appendChild(row);
    }
  }, 250);
});

// ---------------- NEW GROUP ----------------

$('#btn-new-group').addEventListener('click', () => {
  selectedGroupMembers.clear();
  $('#new-group-name').value = '';
  $('#new-group-search').value = '';
  $('#new-group-results').innerHTML = '';
  renderGroupChips();
  showModal('#modal-new-group');
});

let newGroupDebounce = null;
$('#new-group-search').addEventListener('input', () => {
  clearTimeout(newGroupDebounce);
  newGroupDebounce = setTimeout(async () => {
    const q = $('#new-group-search').value.trim();
    const results = $('#new-group-results');
    if (!q) { results.innerHTML = ''; return; }
    const { users } = await API.searchUsers(q);
    results.innerHTML = '';
    for (const u of users) {
      if (selectedGroupMembers.has(u.id)) continue;
      const row = document.createElement('div');
      row.className = 'user-row';
      row.innerHTML = `<img class="avatar avatar-sm" src="${avatarUrl(u)}"><div><div class="user-row-name">${escapeHtml(u.displayName)}</div><div class="user-row-sub">@${escapeHtml(u.username)}</div></div>`;
      row.addEventListener('click', () => {
        selectedGroupMembers.set(u.id, u);
        renderGroupChips();
        $('#new-group-search').value = '';
        results.innerHTML = '';
      });
      results.appendChild(row);
    }
  }, 250);
});

function renderGroupChips() {
  const box = $('#new-group-selected');
  box.innerHTML = '';
  for (const u of selectedGroupMembers.values()) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = `${escapeHtml(u.displayName)} <span class="chip-x">${iconSvg('x', 12)}</span>`;
    chip.querySelector('.chip-x').addEventListener('click', () => {
      selectedGroupMembers.delete(u.id);
      renderGroupChips();
    });
    box.appendChild(chip);
  }
}

$('#btn-create-group').addEventListener('click', async () => {
  const name = $('#new-group-name').value.trim();
  if (!name || selectedGroupMembers.size === 0) return;
  const { conversation } = await API.createGroup({ name, memberIds: [...selectedGroupMembers.keys()] });
  socket.emit('conversation:new', { conversationId: conversation.id, memberIds: [...selectedGroupMembers.keys()] });
  hideModal('#modal-new-group');
  await loadConversations();
  openConversation(conversation.id);
});

// ---------------- CHAT INFO PANEL ----------------

$('#btn-chat-info').addEventListener('click', () => {
  const conv = getConversation(activeConversationId);
  if (!conv) return;
  renderInfoPanel(conv);
  $('#info-panel').classList.remove('hidden');
});
$('#btn-close-info').addEventListener('click', () => $('#info-panel').classList.add('hidden'));

function renderInfoPanel(conv) {
  const body = $('#info-panel-body');
  const isAdmin = conv.type === 'group' && conv.members.find(m => m.id === me.id);
  body.innerHTML = `
    <div class="info-avatar-block">
      <img class="avatar avatar-xl" src="${avatarUrl({ displayName: conv.name, avatarUrl: conv.avatarUrl, id: conv.id })}">
      <h3>${escapeHtml(conv.name)}</h3>
      ${conv.type === 'group' ? `<p>${conv.members.length} ${conv.members.length === 1 ? t('member') : t('members')}</p>` : `<p>@${escapeHtml(conv.peer?.username || '')}</p>`}
    </div>
    ${conv.type === 'group' ? `<div class="info-section-title">${t('members')}</div><div class="info-members" id="info-members"></div>` : ''}
  `;
  if (conv.type === 'group') {
    const membersBox = $('#info-members');
    for (const mUser of conv.members) {
      const row = document.createElement('div');
      row.className = 'user-row';
      row.innerHTML = `<img class="avatar avatar-sm" src="${avatarUrl(mUser)}"><div><div class="user-row-name">${escapeHtml(mUser.displayName)}${mUser.id === me.id ? ` (${t('you')})` : ''}</div><div class="user-row-sub">@${escapeHtml(mUser.username)}</div></div>`;
      membersBox.appendChild(row);
    }
  }
}

// ---------------- PROFILE ----------------

$('#btn-profile').addEventListener('click', () => {
  $('#profile-avatar-preview').src = avatarUrl(me);
  $('#profile-displayname').value = me.displayName;
  $('#profile-status').value = me.statusText || '';
  applyTheme(localStorage.getItem('nomad_theme') || 'system');
  refreshNotifPanel();
  showModal('#modal-profile');
});

// ---------------- THEME ----------------

function applyTheme(choice) {
  if (choice === 'light' || choice === 'dark') {
    document.documentElement.setAttribute('data-theme', choice);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  $all('.theme-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeChoice === (choice || 'system'));
  });
}

$all('.theme-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    const choice = btn.dataset.themeChoice;
    localStorage.setItem('nomad_theme', choice);
    applyTheme(choice);
  });
});

applyTheme(localStorage.getItem('nomad_theme') || 'system');

// ---------------- NOTIFICATIONS ----------------

async function refreshNotifPanel() {
  const toggle = $('#notif-toggle');
  const hint = $('#notif-hint');
  if (!Push.supported) {
    toggle.checked = false;
    toggle.disabled = true;
    hint.textContent = t('notif_unsupported');
    return;
  }
  if (Notification.permission === 'denied') {
    toggle.checked = false;
    toggle.disabled = true;
    hint.textContent = t('notif_denied');
    return;
  }
  toggle.disabled = false;
  const subscribed = await Push.isSubscribed();
  toggle.checked = subscribed;
  hint.textContent = subscribed ? t('notif_on') : t('notif_off');
}

$('#notif-toggle').addEventListener('change', async (e) => {
  const enable = e.target.checked;
  const hint = $('#notif-hint');
  try {
    if (enable) {
      await Push.enable();
      hint.textContent = t('notif_on');
    } else {
      await Push.disable();
      hint.textContent = t('notif_off');
    }
  } catch (err) {
    e.target.checked = !enable;
    hint.textContent = err.message || t('notif_enable_error');
  }
});

// ---------------- PWA INSTALL ----------------

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  $('#btn-install-app').classList.remove('hidden');
});

$('#btn-install-app').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $('#btn-install-app').classList.add('hidden');
});

window.addEventListener('appinstalled', () => {
  $('#btn-install-app').classList.add('hidden');
});

$('#btn-change-avatar').addEventListener('click', () => $('#profile-avatar-input').click());
$('#profile-avatar-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const { url } = await API.upload(file);
    $('#profile-avatar-preview').src = url;
    me._pendingAvatar = url;
  } catch (err) { alert(err.message || t('error_generic')); }
});

$('#btn-save-profile').addEventListener('click', async () => {
  const { user } = await API.updateMe({
    displayName: $('#profile-displayname').value.trim(),
    statusText: $('#profile-status').value.trim(),
    avatarUrl: me._pendingAvatar || undefined
  });
  me = user;
  $('#my-avatar').src = avatarUrl(me);
  hideModal('#modal-profile');
});

// language switch persists to server for logged-in user
const _origSetLang = setLang;
setLang = function (lang) {
  _origSetLang(lang);
  if (me) API.updateMe({ language: lang }).catch(() => {});
  if (activeConversationId) renderMessages(activeConversationId);
  if (conversations.length) renderChatList();
};

// ---------------- CALLS ----------------

function initCallHandlers() {
  CallManager.init(socket, me.id, {
    onLocalStream: (stream) => setVideoTile('local', stream, true),
    onRemoteStream: (userId, stream) => setVideoTile(userId, stream, false, memberName(userId)),
    onRemoteStreamRemoved: (userId) => removeVideoTile(userId),
    onIncomingCall: ({ from, kind, conversationId }) => showIncomingCallUI(from, kind, conversationId),
    onCallStateChange: (state) => updateCallStatusUI(state),
    onCallEnded: () => closeCallOverlay(),
    onRejected: () => { updateCallStatusUI('rejected'); setTimeout(closeCallOverlay, 1200); },
    onUnavailable: () => { updateCallStatusUI('unavailable'); setTimeout(closeCallOverlay, 1500); }
  });
}

function memberName(userId) {
  const conv = getConversation(CallManager.conversationId);
  const u = conv?.members?.find(m => m.id === userId);
  return u ? u.displayName : '';
}

$('#btn-voice-call').addEventListener('click', () => startOutgoingCall('audio'));
$('#btn-video-call').addEventListener('click', () => startOutgoingCall('video'));

async function startOutgoingCall(kind) {
  const conv = getConversation(activeConversationId);
  if (!conv) return;
  if (CallManager.isActive || CallManager.isRinging) return;
  const targets = conv.type === 'group' ? conv.members.map(m => m.id) : [conv.peer.id];
  openCallOverlay(conv.name, avatarUrl({ displayName: conv.name, avatarUrl: conv.avatarUrl, id: conv.id }), kind);
  updateCallStatusUI('calling');
  try {
    await CallManager.startCall(activeConversationId, kind, targets);
  } catch (err) {
    alert(t('error_generic'));
    closeCallOverlay();
  }
}

function showIncomingCallUI(from, kind, conversationId) {
  const conv = getConversation(conversationId);
  openCallOverlay(from.displayName, avatarUrl(from), kind, true);
  $('#call-status').textContent = kind === 'video' ? t('incoming_video') : t('incoming_voice');
  const actions = $('#call-actions');
  actions.innerHTML = '';
  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'call-btn accept';
  acceptBtn.innerHTML = iconSvg('check', 24);
  acceptBtn.title = t('accept');
  acceptBtn.addEventListener('click', async () => {
    await CallManager.acceptIncoming();
    renderActiveCallActions();
    $('#call-overlay').classList.add('in-call');
  });
  const declineBtn = document.createElement('button');
  declineBtn.className = 'call-btn decline';
  declineBtn.innerHTML = iconSvg('x', 24);
  declineBtn.title = t('decline');
  declineBtn.addEventListener('click', () => {
    CallManager.declineIncoming();
    closeCallOverlay();
  });
  actions.appendChild(acceptBtn);
  actions.appendChild(declineBtn);
}

function renderActiveCallActions(kind) {
  const callKind = kind || CallManager.kind;
  const actions = $('#call-actions');
  actions.innerHTML = '';
  const muteBtn = document.createElement('button');
  muteBtn.className = 'call-btn';
  muteBtn.innerHTML = iconSvg('mic', 22);
  muteBtn.title = t('mute');
  muteBtn.addEventListener('click', () => {
    const muted = CallManager.toggleMute();
    muteBtn.innerHTML = iconSvg(muted ? 'micOff' : 'mic', 22);
    muteBtn.title = muted ? t('unmute') : t('mute');
  });
  actions.appendChild(muteBtn);

  if (callKind === 'video') {
    const camBtn = document.createElement('button');
    camBtn.className = 'call-btn';
    camBtn.innerHTML = iconSvg('video', 22);
    camBtn.title = t('camera_off');
    camBtn.addEventListener('click', () => {
      const off = CallManager.toggleCamera();
      camBtn.innerHTML = iconSvg(off ? 'videoOff' : 'video', 22);
      camBtn.title = off ? t('camera_on') : t('camera_off');
    });
    actions.appendChild(camBtn);
  }

  const hangupBtn = document.createElement('button');
  hangupBtn.className = 'call-btn decline hangup-btn';
  hangupBtn.innerHTML = iconSvg('phone', 22);
  hangupBtn.title = t('hang_up');
  hangupBtn.addEventListener('click', () => {
    CallManager.hangUp();
    closeCallOverlay();
  });
  actions.appendChild(hangupBtn);
}

function openCallOverlay(name, avatar, kind, isIncomingRing) {
  $('#call-avatar').src = avatar;
  $('#call-name').textContent = name;
  $('#call-status').textContent = isIncomingRing ? '' : t('calling');
  $('#call-video-grid').innerHTML = '';
  $('#call-overlay').classList.remove('hidden');
  $('#call-overlay').classList.remove('in-call');
  $('#call-overlay').classList.toggle('audio-only', kind !== 'video');
  if (!isIncomingRing) renderActiveCallActions(kind);
}

function updateCallStatusUI(state) {
  const map = {
    calling: t('calling'),
    active: t('connecting'),
    rejected: t('call_ended'),
    unavailable: t('call_unavailable')
  };
  $('#call-status').textContent = map[state] || '';
  if (state === 'active') {
    renderActiveCallActions();
    $('#call-overlay').classList.add('in-call');
  }
}

function setVideoTile(key, stream, isLocal, label) {
  let tile = document.getElementById(`tile-${key}`);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'video-tile' + (isLocal ? ' local' : '');
    tile.id = `tile-${key}`;
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    if (isLocal) video.muted = true;
    tile.appendChild(video);
    if (label) {
      const cap = document.createElement('div');
      cap.className = 'video-tile-label';
      cap.textContent = label;
      tile.appendChild(cap);
    }
    $('#call-video-grid').appendChild(tile);
  }
  const video = tile.querySelector('video');
  video.srcObject = stream;
  $('#call-status').textContent = '';
}

function removeVideoTile(key) {
  const tile = document.getElementById(`tile-${key}`);
  if (tile) tile.remove();
}

function closeCallOverlay() {
  $('#call-overlay').classList.add('hidden');
  $('#call-video-grid').innerHTML = '';
  $('#call-actions').innerHTML = '';
}

bootstrap();
