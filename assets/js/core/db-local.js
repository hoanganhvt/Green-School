/* =========================================================================
   LocalDB — giả lập Firebase Realtime Database trên localStorage (chế độ demo)
   Cùng giao diện với FirebaseDB để toàn bộ app chạy được không cần mạng.
   Đồng bộ thời gian thực giữa các tab cùng trình duyệt qua sự kiện "storage".
   ========================================================================= */
(function () {
  const GS = window.GS;
  const U = GS.util;
  const clone = (v) => (v === null || v === undefined) ? null : JSON.parse(JSON.stringify(v));
  const parts = (p) => String(p || '').split('/').filter(Boolean);
  const norm = (p) => parts(p).join('/');
  const overlap = (a, b) => { a = norm(a); b = norm(b); return !a || !b || a === b || a.startsWith(b + '/') || b.startsWith(a + '/'); };

  function applyQuery(val, q = {}) {
    if (!val || typeof val !== 'object') return [];
    let arr = Object.entries(val).map(([k, v]) => (v && typeof v === 'object') ? { id: k, ...v } : { id: k, value: v });
    if (q.orderBy) arr.sort((a, b) => { const x = a[q.orderBy], y = b[q.orderBy]; return x === y ? (a.id < b.id ? -1 : 1) : (x == null ? -1 : y == null ? 1 : x < y ? -1 : 1); });
    else arr.sort((a, b) => (a.id < b.id ? -1 : 1));
    if (q.equalTo !== undefined) arr = arr.filter((x) => x[q.orderBy] === q.equalTo);
    if (q.startAt !== undefined) arr = arr.filter((x) => x[q.orderBy] >= q.startAt);
    if (q.limitToLast) arr = arr.slice(-q.limitToLast);
    return arr;
  }

  class LocalDB {
    constructor(key = 'gs_db_v1') {
      this.key = key;
      this.mode = 'demo';
      this.listeners = new Set();
      this.authListeners = new Set();
      this.pending = new Set();
      this.load();
      window.addEventListener('storage', (e) => {
        if (e.key === this.key) { this.load(); this.queue(''); }
        if (e.key === this.key + '_session') this.authListeners.forEach((f) => f());
      });
    }
    async init() { return this; }
    load() { try { this.tree = JSON.parse(localStorage.getItem(this.key)) || {}; } catch (e) { this.tree = this.tree || {}; } }
    save() { try { localStorage.setItem(this.key, JSON.stringify(this.tree)); } catch (e) { console.warn('Không lưu được localStorage', e); } }

    read(p) {
      let n = this.tree;
      for (const k of parts(p)) { if (n === null || typeof n !== 'object') return null; n = n[k]; }
      return n === undefined ? null : clone(n);
    }
    write(p, v) {
      const ks = parts(p);
      if (!ks.length) { this.tree = clone(v) || {}; return; }
      let n = this.tree;
      for (let i = 0; i < ks.length - 1; i++) {
        if (n[ks[i]] === null || typeof n[ks[i]] !== 'object') n[ks[i]] = {};
        n = n[ks[i]];
      }
      const last = ks[ks.length - 1];
      if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, '__inc')) n[last] = (Number(n[last]) || 0) + v.__inc;
      else if (v === null || v === undefined) delete n[last];
      else n[last] = clone(v);
    }
    commit(paths) { this.save(); paths.forEach((p) => this.queue(p)); }
    queue(p) {
      for (const l of this.listeners) if (overlap(l.path, p)) this.pending.add(l);
      if (!this.flushing) {
        this.flushing = true;
        queueMicrotask(() => {
          const ls = Array.from(this.pending); this.pending.clear(); this.flushing = false;
          ls.forEach((l) => this.listeners.has(l) && l.fire());
        });
      }
    }

    /* ---- API giống Firebase ---- */
    async get(p) { return this.read(p); }
    async set(p, v) { this.write(p, v); this.commit([p]); }
    async update(obj, base = '') {
      const paths = [];
      for (const [k, v] of Object.entries(obj)) { const p = base ? `${base}/${k}` : k; this.write(p, v); paths.push(p); }
      this.commit(paths);
    }
    async remove(p) { this.write(p, null); this.commit([p]); }
    async push(p, v) {
      const id = Date.now().toString(36) + U.code(6);
      if (v !== undefined) await this.set(`${p}/${id}`, v);
      return id;
    }
    async transaction(p, fn) {
      const cur = this.read(p);
      const nv = fn(cur);
      if (nv === undefined) return { committed: false, value: cur };
      this.write(p, nv); this.commit([p]);
      return { committed: true, value: clone(nv) };
    }
    on(path, cb) {
      const l = { path, fire: () => cb(this.read(path)) };
      this.listeners.add(l); l.fire();
      return () => this.listeners.delete(l);
    }
    async query(path, q) { return applyQuery(this.read(path), q); }
    onQuery(path, q, cb) {
      const l = { path, fire: () => cb(applyQuery(this.read(path), q)) };
      this.listeners.add(l); l.fire();
      return () => this.listeners.delete(l);
    }
    inc(n) { return { __inc: n }; }

    /* ---- Xác thực (demo: lưu băm mật khẩu trong nhánh _auth) ---- */
    session() { try { return localStorage.getItem(this.key + '_session'); } catch (e) { return this._mem || null; } }
    setSession(uid) {
      this._mem = uid;
      try { uid ? localStorage.setItem(this.key + '_session', uid) : localStorage.removeItem(this.key + '_session'); } catch (e) { /* bỏ qua */ }
      this.authListeners.forEach((f) => f());
    }
    currentUid() { return this.session(); }
    onAuth(cb) { const f = () => cb(this.currentUid()); this.authListeners.add(f); f(); return () => this.authListeners.delete(f); }
    async createAuthUser(username, password) {
      if (this.read(`_auth/${username}`)) throw GS.err('auth/username-taken');
      const uid = 'u' + U.uid(11);
      await this.set(`_auth/${username}`, { uid, hash: await U.hash(`${password}|${username}`) });
      return { uid, email: null };
    }
    async signUp(username, password) { const r = await this.createAuthUser(username, password); this.setSession(r.uid); return r; }
    async signIn(username, password) {
      const a = this.read(`_auth/${username}`);
      if (!a || a.hash !== await U.hash(`${password}|${username}`)) throw GS.err('auth/invalid-credential');
      this.setSession(a.uid);
      return a.uid;
    }
    async signOut() { this.setSession(null); }
    async changePassword(username, oldPw, newPw) {
      const a = this.read(`_auth/${username}`);
      if (!a || a.hash !== await U.hash(`${oldPw}|${username}`)) throw GS.err('auth/invalid-credential');
      await this.set(`_auth/${username}/hash`, await U.hash(`${newPw}|${username}`));
    }
    /* Chỉ có ở chế độ demo: admin đặt mật khẩu mới trực tiếp */
    async adminSetPassword(username, newPw) {
      if (!this.read(`_auth/${username}`)) throw new Error('Không tìm thấy tài khoản');
      await this.set(`_auth/${username}/hash`, await U.hash(`${newPw}|${username}`));
    }
    async removeAuthUser(username) { await this.remove(`_auth/${username}`); }
  }

  GS.LocalDB = LocalDB;
  GS.applyQuery = applyQuery;
})();
