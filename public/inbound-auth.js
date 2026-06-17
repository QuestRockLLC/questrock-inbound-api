window.InboundAuth = {
  async me() {
    const res = await fetch('/api/me', { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.ok ? data : null;
  },

  async requireAuth(options = {}) {
    const user = await this.me();
    if (!user) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `/login.html?next=${next}`;
      return null;
    }
    if (options.requireAdmin && !user.isAdmin) {
      location.href = '/mailer-lo/';
      return null;
    }
    if (options.requireCallTracker && !user.canAccessCallTracker) {
      location.href = user.isAdmin ? '/mailer-import/' : '/mailer-lo/';
      return null;
    }
    return user;
  },

  async apiGet(path) {
    const res = await fetch(path, { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  },

  async apiPost(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  },

  signOut() {
    fetch('/api/auth-logout', { method: 'POST', credentials: 'include' }).finally(() => {
      location.href = '/login.html';
    });
  },
};
