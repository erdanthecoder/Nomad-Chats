const API = {
  async _request(method, url, body) {
    const opts = {
      method,
      headers: {},
      credentials: 'same-origin'
    };
    if (body instanceof FormData) {
      opts.body = body;
    } else if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Request failed');
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get(url) { return this._request('GET', url); },
  post(url, body) { return this._request('POST', url, body); },
  patch(url, body) { return this._request('PATCH', url, body); },
  del(url) { return this._request('DELETE', url); },

  register(data) { return this.post('/api/auth/register', data); },
  login(data) { return this.post('/api/auth/login', data); },
  logout() { return this.post('/api/auth/logout'); },
  me() { return this.get('/api/auth/me'); },
  updateMe(data) { return this.patch('/api/auth/me', data); },
  searchUsers(q) { return this.get(`/api/auth/users/search?q=${encodeURIComponent(q)}`); },

  conversations() { return this.get('/api/conversations'); },
  conversation(id) { return this.get(`/api/conversations/${id}`); },
  createDirect(userId) { return this.post('/api/conversations/direct', { userId }); },
  createGroup(data) { return this.post('/api/conversations/group', data); },
  updateGroup(id, data) { return this.patch(`/api/conversations/${id}`, data); },
  addMembers(id, userIds) { return this.post(`/api/conversations/${id}/members`, { userIds }); },
  removeMember(id, userId) { return this.del(`/api/conversations/${id}/members/${userId}`); },
  messages(id, before) { return this.get(`/api/conversations/${id}/messages${before ? `?before=${before}` : ''}`); },
  markRead(id) { return this.post(`/api/conversations/${id}/read`); },

  contacts() { return this.get('/api/contacts'); },
  addContact(userId) { return this.post('/api/contacts', { userId }); },

  async upload(file) {
    const fd = new FormData();
    fd.append('file', file);
    return this._request('POST', '/api/upload', fd);
  }
};
