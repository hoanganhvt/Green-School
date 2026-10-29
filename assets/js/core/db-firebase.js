/* =========================================================================
   FirebaseDB — kết nối Firebase Realtime Database + Firebase Authentication
   Dùng SDK "compat" tải từ CDN chính thức của Google (không cần build).
   Học sinh đăng nhập bằng TÊN ĐĂNG NHẬP: hệ thống tự tạo email nội bộ
   <username>.<ngẫu nhiên>@<AUTH_EMAIL_DOMAIN> và lưu ánh xạ trong /usernames.
   ========================================================================= */
(function () {
  const GS = window.GS;
  const U = GS.util;

  class FirebaseDB {
    constructor(config) { this.config = config; this.mode = 'firebase'; }

    async init() {
      if (GS.USE_EMULATORS) {
        await Promise.all([GS.EMULATORS.databasePort, GS.EMULATORS.authPort].map((port) =>
          fetch(`http://${GS.EMULATORS.host}:${port}/`, { signal: AbortSignal.timeout(4000) })));
      }
      const v = GS.FIREBASE_SDK_VERSION;
      const base = `https://www.gstatic.com/firebasejs/${v}`;
      await U.loadScript(`${base}/firebase-app-compat.js`);
      await Promise.all([U.loadScript(`${base}/firebase-auth-compat.js`), U.loadScript(`${base}/firebase-database-compat.js`)]);
      if (!this.config || !this.config.databaseURL) throw new Error('Cấu hình Firebase thiếu databaseURL');
      this.app = firebase.apps.find((a) => a.name === '[DEFAULT]') || firebase.initializeApp(this.config);
      this.db = this.app.database();
      this.auth = this.app.auth();
      if (GS.USE_EMULATORS) {
        this.db.useEmulator(GS.EMULATORS.host, GS.EMULATORS.databasePort);
        this.auth.useEmulator(`http://${GS.EMULATORS.host}:${GS.EMULATORS.authPort}`, { disableWarnings: true });
      }
      await this.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
      await new Promise((r) => { const un = this.auth.onAuthStateChanged(() => { un(); r(); }); });
      /* Theo dõi trạng thái kết nối tới máy chủ */
      this.db.ref('.info/connected').on('value', (s) => { this.connected = !!s.val(); document.documentElement.dataset.online = this.connected ? '1' : '0'; });
      /* Lệch giờ giữa máy và máy chủ — dùng để so sánh thời gian chính xác hơn */
      this.db.ref('.info/serverTimeOffset').on('value', (s) => { this.offset = s.val() || 0; });
      return this;
    }

    ref(p) { return this.db.ref(p || '/'); }
    async get(p) { const s = await this.ref(p).get(); return s.exists() ? s.val() : null; }
    set(p, v) { return this.ref(p).set(v); }
    update(obj, base = '') { return this.ref(base || '/').update(obj); }
    remove(p) { return this.ref(p).remove(); }
    async push(p, v) { const r = this.ref(p).push(); if (v !== undefined) await r.set(v); return r.key; }
    /* Lưu ý: SDK gọi hàm lần đầu với giá trị trong bộ nhớ đệm (thường là null).
       Nếu hàm muốn huỷ khi gặp null, ta ghi "null" để máy chủ so sánh và gọi lại
       với giá trị thật — tránh huỷ nhầm khi chưa có dữ liệu trong bộ nhớ đệm. */
    async transaction(p, fn) {
      let aborted = false;
      const r = await this.ref(p).transaction((cur) => {
        const c = cur === undefined ? null : cur;
        const v = fn(c);
        aborted = v === undefined;
        if (aborted && c === null) return null;
        return v;
      });
      return { committed: r.committed && !aborted, value: r.snapshot.val() };
    }
    on(p, cb) {
      const r = this.ref(p);
      const h = (s) => cb(s.val());
      r.on('value', h, (e) => console.warn('[Firebase]', p, e.message));
      return () => r.off('value', h);
    }
    buildQuery(p, q = {}) {
      let r = this.ref(p);
      if (q.orderBy) r = r.orderByChild(q.orderBy); else r = r.orderByKey();
      if (q.equalTo !== undefined) r = r.equalTo(q.equalTo);
      if (q.startAt !== undefined) r = r.startAt(q.startAt);
      if (q.limitToLast) r = r.limitToLast(q.limitToLast);
      return r;
    }
    toArr(s) { const a = []; s.forEach((c) => { const v = c.val(); a.push(v && typeof v === 'object' ? { id: c.key, ...v } : { id: c.key, value: v }); }); return a; }
    async query(p, q) { return this.toArr(await this.buildQuery(p, q).get()); }
    onQuery(p, q, cb) {
      const r = this.buildQuery(p, q);
      const h = (s) => cb(this.toArr(s));
      r.on('value', h, (e) => console.warn('[Firebase]', p, e.message));
      return () => r.off('value', h);
    }
    inc(n) { return firebase.database.ServerValue.increment(n); }
    now() { return Date.now() + (this.offset || 0); }

    /* ---- Xác thực ---- */
    currentUid() { return this.auth.currentUser ? this.auth.currentUser.uid : null; }
    onAuth(cb) { return this.auth.onAuthStateChanged((u) => cb(u ? u.uid : null)); }
    makeEmail(username) { return `${username}.${U.code(5).toLowerCase()}@${GS.AUTH_EMAIL_DOMAIN}`; }
    async signUp(username, password) {
      const email = this.makeEmail(username);
      const c = await this.auth.createUserWithEmailAndPassword(email, password);
      return { uid: c.user.uid, email };
    }
    /* Admin tạo tài khoản mà KHÔNG bị đăng xuất: dùng một app phụ */
    async createAuthUser(username, password) {
      const name = 'gs-secondary';
      const app2 = firebase.apps.find((a) => a.name === name) || firebase.initializeApp(this.config, name);
      if (GS.USE_EMULATORS && !this.secondaryAuthConfigured) {
        app2.auth().useEmulator(`http://${GS.EMULATORS.host}:${GS.EMULATORS.authPort}`, { disableWarnings: true });
        this.secondaryAuthConfigured = true;
      }
      const email = this.makeEmail(username);
      const c = await app2.auth().createUserWithEmailAndPassword(email, password);
      const uid = c.user.uid;
      await app2.auth().signOut();
      return { uid, email };
    }
    async signIn(username, password) {
      const m = await this.get(`usernames/${username}`);
      if (!m || !m.email) throw GS.err('auth/invalid-credential');
      await this.auth.signInWithEmailAndPassword(m.email, password);
      return this.auth.currentUser.uid;
    }
    signOut() { return this.auth.signOut(); }
    async changePassword(username, oldPw, newPw) {
      const u = this.auth.currentUser;
      const cred = firebase.auth.EmailAuthProvider.credential(u.email, oldPw);
      await u.reauthenticateWithCredential(cred);
      await u.updatePassword(newPw);
    }
    async removeAuthUser() { /* Client không xoá được tài khoản người khác — xoá trong Firebase Console nếu cần */ }
  }

  GS.FirebaseDB = FirebaseDB;
})();
