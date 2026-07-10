const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

let iceServersCache = null;
async function loadIceServers() {
  if (iceServersCache) return iceServersCache;
  try {
    const res = await fetch('/api/ice-servers', { credentials: 'include' });
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    iceServersCache = (data.iceServers && data.iceServers.length) ? data.iceServers : DEFAULT_ICE_SERVERS;
  } catch {
    iceServersCache = DEFAULT_ICE_SERVERS;
  }
  return iceServersCache;
}

const CallManager = {
  socket: null,
  myUserId: null,
  callbacks: {},

  callId: null,
  conversationId: null,
  kind: null, // 'audio' | 'video'
  isActive: false,
  isRinging: false,
  incomingFrom: null,
  targetUserIds: [], // all intended participants (excluding self)
  localStream: null,
  peers: {}, // userId -> { pc, stream }

  init(socket, myUserId, callbacks) {
    this.socket = socket;
    this.myUserId = myUserId;
    this.callbacks = callbacks;

    socket.on('call:incoming', (data) => this._onIncoming(data));
    socket.on('call:offer', (data) => this._onOffer(data));
    socket.on('call:answer', (data) => this._onAnswer(data));
    socket.on('call:ice-candidate', (data) => this._onIce(data));
    socket.on('call:reject', () => this._onRemoteReject());
    socket.on('call:peer-joined', (data) => this._onPeerJoined(data));
    socket.on('call:peer-left', (data) => this._onPeerLeft(data));
    socket.on('call:ended', (data) => this._onEnded(data));
    socket.on('call:unavailable', () => {
      this.callbacks.onUnavailable && this.callbacks.onUnavailable();
      this._teardown();
    });

    loadIceServers();
  },

  async startCall(conversationId, kind, targetUserIds) {
    this.callId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.conversationId = conversationId;
    this.kind = kind;
    this.targetUserIds = targetUserIds.filter(id => id !== this.myUserId);
    this.isActive = true;

    await this._getLocalMedia(kind);
    this.socket.emit('call:invite', { conversationId, callId: this.callId, kind });
    this.callbacks.onCallStateChange && this.callbacks.onCallStateChange('calling');
    this._announceJoin();
  },

  async acceptIncoming() {
    if (!this.isRinging) return;
    this.isRinging = false;
    this.isActive = true;
    await this._getLocalMedia(this.kind);
    this.callbacks.onCallStateChange && this.callbacks.onCallStateChange('active');
    this._announceJoin();
  },

  declineIncoming() {
    if (!this.isRinging) return;
    this.socket.emit('call:reject', { callId: this.callId, targetUserId: this.incomingFrom });
    this._teardown();
  },

  hangUp() {
    if (this.callId && this.conversationId) {
      this.socket.emit('call:end', { callId: this.callId, conversationId: this.conversationId });
      this.socket.emit('call:leave', { callId: this.callId, conversationId: this.conversationId });
    }
    this._teardown();
  },

  toggleMute() {
    if (!this.localStream) return null;
    const track = this.localStream.getAudioTracks()[0];
    if (!track) return null;
    track.enabled = !track.enabled;
    return !track.enabled; // returns muted state
  },

  toggleCamera() {
    if (!this.localStream) return null;
    const track = this.localStream.getVideoTracks()[0];
    if (!track) return null;
    track.enabled = !track.enabled;
    return !track.enabled; // returns camera-off state
  },

  async _getLocalMedia(kind) {
    const constraints = kind === 'video'
      ? { audio: true, video: { width: 640, height: 480 } }
      : { audio: true, video: false };
    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    this.callbacks.onLocalStream && this.callbacks.onLocalStream(this.localStream);
  },

  _announceJoin() {
    this.socket.emit('call:join', { callId: this.callId, conversationId: this.conversationId });
  },

  _onIncoming({ conversationId, callId, kind, from, targets }) {
    if (this.isActive || this.isRinging) return; // busy
    this.callId = callId;
    this.conversationId = conversationId;
    this.kind = kind;
    this.incomingFrom = from.id;
    this.targetUserIds = (targets || []).filter(id => id !== this.myUserId);
    this.isRinging = true;
    this.callbacks.onIncomingCall && this.callbacks.onIncomingCall({ from, kind, conversationId });
  },

  _shouldOffer(otherUserId) {
    return this.myUserId > otherUserId;
  },

  async _getOrCreatePeer(otherUserId) {
    if (this.peers[otherUserId]) return this.peers[otherUserId].pc;
    const iceServers = await loadIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    this.peers[otherUserId] = { pc, stream: null };

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.socket.emit('call:ice-candidate', {
          callId: this.callId, targetUserId: otherUserId, candidate: e.candidate
        });
      }
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      this.peers[otherUserId].stream = stream;
      this.callbacks.onRemoteStream && this.callbacks.onRemoteStream(otherUserId, stream);
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        this._removePeer(otherUserId);
      }
    };

    return pc;
  },

  async _onPeerJoined({ callId, userId }) {
    if (callId !== this.callId || userId === this.myUserId) return;
    if (!this.isActive) return;
    if (!this.targetUserIds.includes(userId)) this.targetUserIds.push(userId);
    this.socket.emit('call:announce', { callId: this.callId, targetUserId: userId });

    if (this.peers[userId]) return; // already connecting
    if (this._shouldOffer(userId)) {
      const pc = await this._getOrCreatePeer(userId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.socket.emit('call:offer', {
        callId: this.callId, targetUserId: userId, sdp: offer,
        conversationId: this.conversationId, kind: this.kind
      });
    }
  },

  async _onOffer({ callId, fromUserId, sdp }) {
    if (callId !== this.callId) return;
    if (!this.isActive) return; // must have accepted already
    const pc = await this._getOrCreatePeer(fromUserId);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.socket.emit('call:answer', { callId: this.callId, targetUserId: fromUserId, sdp: answer });
  },

  async _onAnswer({ callId, fromUserId, sdp }) {
    if (callId !== this.callId) return;
    const peer = this.peers[fromUserId];
    if (!peer) return;
    await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
  },

  async _onIce({ callId, fromUserId, candidate }) {
    if (callId !== this.callId) return;
    const peer = this.peers[fromUserId];
    if (!peer) return;
    try { await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
  },

  _onRemoteReject() {
    this.callbacks.onRejected && this.callbacks.onRejected();
    this._teardown();
  },

  _removePeer(userId) {
    const peer = this.peers[userId];
    if (peer) {
      peer.pc.close();
      delete this.peers[userId];
      this.callbacks.onRemoteStreamRemoved && this.callbacks.onRemoteStreamRemoved(userId);
    }
  },

  _onPeerLeft({ callId, userId }) {
    if (callId !== this.callId) return;
    this._removePeer(userId);
    if (Object.keys(this.peers).length === 0 && this.isActive) {
      this.callbacks.onCallEnded && this.callbacks.onCallEnded();
      this._teardown();
    }
  },

  _onEnded({ callId }) {
    if (callId !== this.callId) return;
    this.callbacks.onCallEnded && this.callbacks.onCallEnded();
    this._teardown();
  },

  _teardown() {
    for (const userId of Object.keys(this.peers)) this._removePeer(userId);
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    this.callId = null;
    this.conversationId = null;
    this.kind = null;
    this.isActive = false;
    this.isRinging = false;
    this.incomingFrom = null;
    this.targetUserIds = [];
  }
};
