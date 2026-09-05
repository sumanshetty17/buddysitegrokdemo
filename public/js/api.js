const API = {
  token() { return localStorage.getItem('token'); },
  setAuth(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  },
  user() {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  },
  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    location.href = '/login.html';
  },
  async call(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (this.token()) headers['Authorization'] = 'Bearer ' + this.token();
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  },
  requireLogin() {
    if (!this.token()) location.href = '/login.html';
  }
};
