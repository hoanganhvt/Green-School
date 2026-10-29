/* =========================================================================
   Services — khởi động, cài đặt, xác thực, quy trình tích điểm, quản trị
   -------------------------------------------------------------------------
   CẤU TRÚC DỮ LIỆU (Realtime Database)
   settings/                      cài đặt chung + rules (quy tắc điểm)
   classes/{classId}              { id, name, grade, points, count, byType:{plastic,metal} }
   weekly/{2026-W43}/{classId}    { points, count, byType:{...} }   (tổng hợp theo tuần)
   students/{code}                { code, fullName, className, classId, dob, gender,
                                    uid, username, points, count, lastTs }
   users/{uid}                    { uid, username, fullName, className, classId,
                                    studentCode, role:'student'|'admin', status }
   usernames/{username}           { uid, email, studentCode }
   admins/{uid}                   true
   bins/{binId}                   { id, name, location, count, lastSeen, ip,
                                    activeSession:{ uid, studentCode, username,
                                    fullName, classId, className, startedAt, expiresAt } }
   events/{txId}                  ← ESP32 GHI VÀO ĐÂY
                                  { txId, binId, type, studentCode?, username?, ts,
                                    status:'pending'|'processing'|'processed'|'rejected', reason?, points? }
   transactions/{txId}            giao dịch đã cộng điểm (lịch sử)
   ========================================================================= */
(function () {
  const GS = window.GS;
  const U = GS.util;
  const S = GS.svc = {};
  GS.state = { settings: { ...GS.DEFAULTS }, uid: null, user: null, student: null, isAdmin: false };

  /* ---------- Bus sự kiện nhỏ ---------- */
  const handlers = {};
  GS.bus = {
    on(ev, fn) { (handlers[ev] = handlers[ev] || new Set()).add(fn); return () => handlers[ev].delete(fn); },
    emit(ev, data) { (handlers[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }
  };

  /* ---------- Lỗi có thông điệp tiếng Việt ---------- */
  const MSG = {
    'auth/invalid-credential': 'Sai tên đăng nhập hoặc mật khẩu',
    'auth/wrong-password': 'Sai tên đăng nhập hoặc mật khẩu',
    'auth/user-not-found': 'Sai tên đăng nhập hoặc mật khẩu',
    'auth/invalid-login-credentials': 'Sai tên đăng nhập hoặc mật khẩu',
    'auth/username-taken': 'Tên đăng nhập này đã có người dùng',
    'auth/email-already-in-use': 'Tên đăng nhập này đã có người dùng',
    'auth/weak-password': 'Mật khẩu cần ít nhất 6 ký tự',
    'auth/too-many-requests': 'Bạn thử quá nhiều lần. Chờ vài phút rồi thử lại',
    'auth/network-request-failed': 'Không có kết nối mạng',
    'auth/requires-recent-login': 'Hãy đăng nhập lại rồi thử lại',
    'PERMISSION_DENIED': 'Không có quyền thực hiện thao tác này (kiểm tra Firebase Rules)'
  };
  GS.err = (code, msg) => { const e = new Error(msg || MSG[code] || code); e.code = code; return e; };
  S.errMsg = (e) => {
    if (!e) return 'Có lỗi xảy ra';
    const code = e.code || '';
    if (MSG[code]) return MSG[code];
    if (/PERMISSION_DENIED|permission_denied/i.test(e.message || '')) return MSG.PERMISSION_DENIED;
    return e.message || String(e);
  };

  GS.now = () => (GS.db && GS.db.now ? GS.db.now() : Date.now());

  /* ---------- Chọn nguồn dữ liệu ---------- */
  S.firebaseConfig = () => {
    if (GS.USE_EMULATORS) return GS.EMULATOR_CONFIG;
    if (GS.FIREBASE_CONFIG && location.hostname === 'smarttrashbin-98428.web.app') return GS.FIREBASE_CONFIG;
    if (GS.FIREBASE_CONFIG && location.hostname === 'smarttrashbin-98428.firebaseapp.com') return GS.FIREBASE_CONFIG;
    try {
      if (localStorage.getItem('gs_force_demo') === '1') return null;
      const local = localStorage.getItem('gs_firebase_config');
      if (local) return JSON.parse(local);
    } catch (e) { /* bỏ qua */ }
    return GS.FIREBASE_CONFIG || null;
  };
  S.configSource = () => {
    if (GS.USE_EMULATORS) return 'emulator';
    try {
      if (localStorage.getItem('gs_force_demo') === '1') return 'forced-demo';
      if (localStorage.getItem('gs_firebase_config')) return 'admin';
    } catch (e) { /* bỏ qua */ }
    return GS.FIREBASE_CONFIG ? 'file' : 'none';
  };

  GS.boot = async () => {
    const cfg = S.firebaseConfig();
    if (cfg) {
      try { GS.db = await new GS.FirebaseDB(cfg).init(); }
      catch (e) { throw new Error(GS.USE_EMULATORS ? 'Không kết nối được emulator. Chạy npm.cmd run emulators. ' + e.message : 'Không kết nối được Firebase. Vui lòng thử lại. ' + e.message); }
    } else GS.db = new GS.LocalDB();
    if (GS.db.mode === 'demo' && !GS.db.read('meta/seeded')) await GS.seed(GS.db);

    await new Promise((res) => {
      GS.db.on('settings', (v) => {
        const s = { ...GS.DEFAULTS, ...(v || {}) };
        s.rules = (v && v.rules) ? v.rules : GS.DEFAULTS.rules;
        GS.state.settings = s;
        GS.bus.emit('settings', s);
        res();
      });
    });
    await new Promise((res) => {
      let first = true;
      GS.db.onAuth(async (uid) => { await S.loadProfile(uid); if (first) { first = false; res(); } });
    });
  };

  /* ---------- Hồ sơ người dùng ---------- */
  let unProfile = [];
  S.loadProfile = (uid) => new Promise((resolve) => {
    unProfile.forEach((f) => f()); unProfile = [];
    const st = GS.state;
    st.uid = uid; st.user = null; st.student = null; st.isAdmin = false;
    if (!uid) { GS.bus.emit('auth'); resolve(); return; }
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    unProfile.push(GS.db.on(`users/${uid}`, (u) => {
      st.user = u;
      st.isAdmin = !!(u && u.role === 'admin');
      if (u && u.status === 'locked') { U.toast('Tài khoản của bạn đã bị khoá', 'err'); GS.db.signOut(); }
      if (u && u.studentCode && !st._studentSub) {
        st._studentSub = true;
        unProfile.push(GS.db.on(`students/${u.studentCode}`, (s) => { st.student = s; GS.bus.emit('auth'); }));
        unProfile.push(() => { st._studentSub = false; });
      }
      GS.bus.emit('auth');
      finish();
    }));
    setTimeout(finish, 4000);
  });
  S.waitForUser = async (uid, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (GS.state.uid === uid && GS.state.user) return GS.state.user; await U.sleep(60); }
    return GS.state.user;
  };

  /* ---------- Đăng ký / đăng nhập ---------- */
  const USERNAME_RE = /^[a-z0-9_]{4,20}$/;
  S.register = async ({ studentCode, fullName, className, username, password, password2 }) => {
    const code = String(studentCode || '').trim().toUpperCase();
    username = String(username || '').trim().toLowerCase();
    if (!code) throw new Error('Nhập mã học sinh do nhà trường cấp');
    if (!String(fullName || '').trim()) throw new Error('Nhập họ và tên');
    if (!String(className || '').trim()) throw new Error('Chọn lớp của bạn');
    if (!USERNAME_RE.test(username)) throw new Error('Tên đăng nhập gồm 4–20 ký tự: chữ thường không dấu, số, gạch dưới');
    if (String(password || '').length < 6) throw new Error('Mật khẩu cần ít nhất 6 ký tự');
    if (password2 !== undefined && password !== password2) throw new Error('Hai mật khẩu chưa khớp nhau');

    const st = await GS.db.get(`students/${code}`);
    if (!st) throw new Error('Không tìm thấy mã học sinh này. Kiểm tra lại mã trên phiếu được phát');
    if (U.normalize(st.fullName) !== U.normalize(fullName)) throw new Error('Họ và tên chưa khớp với mã học sinh');
    if (st.classId !== U.classId(className)) throw new Error('Lớp chưa khớp với mã học sinh');
    if (st.uid) throw new Error('Mã học sinh này đã được dùng để đăng ký. Nếu quên mật khẩu, hãy nhờ thầy cô quản trị đặt lại');

    const taken = await GS.db.get(`usernames/${username}`);
    if (taken && taken.studentCode !== code) {
      const owner = taken.uid ? await GS.db.get(`users/${taken.uid}`) : null;
      if (owner && owner.status !== 'reset') throw GS.err('auth/username-taken');
    }
    if (taken && GS.db.mode === 'demo') await GS.db.removeAuthUser(username);

    const { uid, email } = await GS.db.signUp(username, password);
    const now = GS.now();
    await GS.db.update({
      [`users/${uid}`]: { uid, username, fullName: st.fullName, className: st.className, classId: st.classId, studentCode: code, role: 'student', status: 'active', createdAt: now },
      [`usernames/${username}`]: { uid, email: email || null, studentCode: code },
      [`students/${code}/uid`]: uid,
      [`students/${code}/username`]: username,
      [`students/${code}/registeredAt`]: now
    });
    await S.loadProfile(uid);
    return uid;
  };

  S.login = async (username, password) => {
    username = String(username || '').trim().toLowerCase();
    if (!username || !password) throw new Error('Nhập tên đăng nhập và mật khẩu');
    const uid = await GS.db.signIn(username, password);
    const u = await GS.db.get(`users/${uid}`);
    if (!u) { await GS.db.signOut(); throw new Error('Tài khoản không còn tồn tại. Liên hệ thầy cô quản trị'); }
    if (u.status === 'locked') { await GS.db.signOut(); throw new Error('Tài khoản đang bị khoá. Liên hệ thầy cô quản trị'); }
    if (u.status === 'reset') { await GS.db.signOut(); throw new Error('Tài khoản đã được đặt lại. Hãy đăng ký lại bằng mã học sinh của bạn'); }
    await S.waitForUser(uid);
    return u;
  };
  S.logout = async () => { await GS.db.signOut(); };

  S.changePassword = async (oldPw, newPw) => {
    if (String(newPw).length < 6) throw new Error('Mật khẩu mới cần ít nhất 6 ký tự');
    await GS.db.changePassword(GS.state.user.username, oldPw, newPw);
  };

  /* Thiết lập admin đầu tiên (chế độ Firebase) */
  S.setupFirstAdmin = async ({ username, password, fullName }) => {
    username = String(username || '').trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw new Error('Tên đăng nhập gồm 4–20 ký tự: chữ thường không dấu, số, gạch dưới');
    if (String(password || '').length < 6) throw new Error('Mật khẩu cần ít nhất 6 ký tự');
    if (await GS.db.get('meta/hasAdmin')) throw new Error('Hệ thống đã có quản trị viên. Hãy đăng nhập');
    const { uid, email } = await GS.db.signUp(username, password);
    const now = GS.now();
    await GS.db.set(`admins/${uid}`, true);
    const initialSettings = await GS.db.get('settings');
    await GS.db.update({
      ...(!initialSettings ? { settings: GS.DEFAULTS } : {}),
      [`users/${uid}`]: { uid, username, fullName: fullName || 'Quản trị viên', role: 'admin', status: 'active', createdAt: now },
      [`usernames/${username}`]: { uid, email: email || null, studentCode: null },
      'meta/hasAdmin': true
    });
    await S.loadProfile(uid);
  };

  /* =======================================================================
     QUY TRÌNH TÍCH ĐIỂM
     ======================================================================= */
  const inc = (n) => GS.db.inc(n);

  /* Tạo các đường dẫn cộng/trừ điểm cho 1 giao dịch (sign = 1 cộng, -1 hoàn) */
  S.aggregatePaths = (tx, sign = 1) => {
    const u = {};
    const p = (Number(tx.points) || 0) * sign;
    const c = tx.countable ? sign : 0;
    const bases = [`classes/${tx.classId}`, `weekly/${tx.weekKey}/${tx.classId}`];
    if (tx.studentCode) bases.push(`students/${tx.studentCode}`);
    bases.forEach((b) => {
      if (p) u[`${b}/points`] = inc(p);
      if (c) { u[`${b}/count`] = inc(c); u[`${b}/byType/${tx.type}`] = inc(c); }
    });
    return u;
  };

  S.ruleFor = (type) => {
    const rules = GS.state.settings.rules || {};
    const key = String(type || '').trim().toLowerCase();
    return rules[key] ? { key, ...rules[key] } : null;
  };

  /* Xử lý 1 sự kiện ESP32 gửi lên. An toàn khi nhiều máy cùng xử lý
     (giao dịch "claim" pending → processing chỉ thành công ở 1 máy). */
  const inflight = new Set();
  S.processEvent = async (id) => {
    if (GS.db.mode !== 'demo') return; // Firebase events are handled by the laptop backend.
    if (inflight.has(id)) return;
    inflight.add(id);
    try {
      const claim = await GS.db.transaction(`events/${id}/status`, (s) => (s === 'pending' ? 'processing' : undefined));
      if (!claim.committed) return;
      const ev = await GS.db.get(`events/${id}`) || {};
      const now = GS.now();
      const fail = (reason) => GS.db.update({ [`events/${id}/status`]: 'rejected', [`events/${id}/reason`]: reason, [`events/${id}/processedAt`]: now });

      if (await GS.db.get(`transactions/${id}`)) return fail('Mã giao dịch đã được tính trước đó');
      const rule = S.ruleFor(ev.type);
      if (!rule) return fail(`Loại rác "${ev.type || '?'}" chưa có trong quy tắc tính điểm`);
      if (rule.enabled === false) return fail(`Loại rác "${rule.label}" đang tạm dừng tính điểm`);

      let ts = Number(ev.ts) || now;
      if (Math.abs(ts - now) > 864e5) ts = now; // đồng hồ ESP32 lệch → dùng giờ hiện tại

      /* Xác định học sinh: mã HS → tên đăng nhập → phiên đang mở trên thùng */
      let code = ev.studentCode ? String(ev.studentCode).toUpperCase() : null;
      if (!code && ev.username) { const m = await GS.db.get(`usernames/${String(ev.username).toLowerCase()}`); code = m && m.studentCode; }
      let session = ev.binId ? await GS.db.get(`bins/${ev.binId}/activeSession`) : null;
      if (!code && session && session.expiresAt > ts - 15000) code = session.studentCode;
      if (!code) return fail('Không có học sinh nào đang đăng nhập ở thùng này');
      /* Sự kiện từ thùng thật phải khớp phiên còn hạn (lượt thử của admin được bỏ qua bước này) */
      if (ev.binId && ev.source !== 'sim') {
        if (!session || session.studentCode !== code) return fail('Học sinh này không có phiên trên thùng, hãy quét lại mã QR');
        if (session.expiresAt < ts - 15000) return fail('Phiên trên thùng đã hết hạn, hãy quét lại mã QR');
      }

      const st = await GS.db.get(`students/${code}`);
      if (!st) return fail(`Mã học sinh ${code} không tồn tại`);
      const cd = (Number(GS.state.settings.cooldownSeconds) || 0) * 1000;
      if (cd && st.lastTs && ts - st.lastTs < cd && ts >= st.lastTs) return fail('Bỏ rác quá nhanh, lượt này không được tính');

      const tx = {
        id, type: rule.key, typeLabel: rule.label, points: Number(rule.points) || 0, countable: true,
        binId: ev.binId || null, classId: st.classId, className: st.className,
        studentCode: code, fullName: st.fullName, username: st.username || ev.username || null,
        ts, weekKey: U.weekKey(ts), source: ev.source || 'esp32'
      };
      const upd = S.aggregatePaths(tx);
      upd[`transactions/${id}`] = tx;
      upd[`events/${id}/status`] = 'processed';
      upd[`events/${id}/points`] = tx.points;
      upd[`events/${id}/studentCode`] = code;
      upd[`events/${id}/classId`] = st.classId;
      upd[`events/${id}/processedAt`] = now;
      upd[`students/${code}/lastTs`] = ts;
      if (ev.binId) {
        upd[`bins/${ev.binId}/count`] = inc(1);
        upd[`bins/${ev.binId}/lastEventAt`] = now;
        if (session && session.studentCode === code) upd[`bins/${ev.binId}/activeSession/expiresAt`] = now + S.sessionMs();
      }
      await GS.db.update(upd);
    } catch (e) {
      console.error('processEvent', id, e);
    } finally { inflight.delete(id); }
  };

  /* Lắng nghe sự kiện chờ xử lý — chạy ở trang quản trị và trang quét QR */
  let procCount = 0, unProc = null;
  S.startProcessor = () => {
    if (GS.db.mode !== 'demo') return () => {};
    procCount++;
    if (!unProc) {
      unProc = GS.db.onQuery('events', { orderBy: 'status', equalTo: 'pending', limitToLast: 50 }, (list) => {
        list.forEach((e) => S.processEvent(e.id));
      });
    }
    return () => { procCount--; if (procCount <= 0 && unProc) { unProc(); unProc = null; procCount = 0; } };
  };

  /* ---------- Phiên bỏ rác (sau khi quét QR) ---------- */
  S.sessionMs = () => Math.max(1, Number(GS.state.settings.sessionMinutes) || 3) * 60e3;
  S.startSession = async (binId) => {
    const st = GS.state;
    if (!st.user || !st.user.studentCode) throw new Error('Tài khoản này không gắn với học sinh nào');
    const now = GS.now();
    const mine = { uid: st.uid, studentCode: st.user.studentCode, username: st.user.username, fullName: st.user.fullName, classId: st.user.classId, className: st.user.className, startedAt: now, expiresAt: now + S.sessionMs() };
    const r = await GS.db.transaction(`bins/${binId}/activeSession`, (cur) => {
      if (cur && cur.expiresAt > GS.now() && cur.studentCode !== mine.studentCode) return undefined;
      if (cur && cur.studentCode === mine.studentCode && cur.expiresAt > GS.now()) return { ...cur, expiresAt: mine.expiresAt };
      return mine;
    });
    return r;
  };
  S.endSession = async (binId) => {
    const code = GS.state.user && GS.state.user.studentCode;
    await GS.db.transaction(`bins/${binId}/activeSession`, (cur) => (cur && cur.studentCode === code ? null : undefined));
  };
  S.extendSession = async (binId) => {
    await GS.db.transaction(`bins/${binId}/activeSession`, (cur) => (cur && cur.studentCode === GS.state.user.studentCode ? { ...cur, expiresAt: GS.now() + S.sessionMs() } : undefined));
  };

  /* Gửi sự kiện giống hệt ESP32 (dùng để chạy thử không cần phần cứng) */
  S.simulateEvent = async ({ binId, type, studentCode }) => {
    const txId = U.txId();
    const ev = { txId, binId, type, ts: GS.now(), status: 'pending', source: 'sim', createdBy: GS.state.uid };
    if (studentCode) ev.studentCode = studentCode;
    await GS.db.set(`events/${txId}`, ev);
    return txId;
  };

  /* =======================================================================
     QUẢN TRỊ
     ======================================================================= */
  S.saveSettings = (patch) => GS.db.update(Object.fromEntries(Object.entries(patch).map(([k, v]) => [`settings/${k}`, v])));

  S.revokeTx = async (id, reason = '') => {
    const tx = await GS.db.get(`transactions/${id}`);
    if (!tx || tx.revoked) return;
    const upd = S.aggregatePaths(tx, -1);
    upd[`transactions/${id}/revoked`] = true;
    upd[`transactions/${id}/revokedAt`] = GS.now();
    upd[`transactions/${id}/revokeReason`] = reason || null;
    if (tx.binId && tx.countable) upd[`bins/${tx.binId}/count`] = inc(-1);
    await GS.db.update(upd);
  };

  S.adjustPoints = async ({ classId, studentCode, points, note }) => {
    points = Math.round(Number(points));
    if (!points) throw new Error('Nhập số điểm khác 0');
    let st = null;
    if (studentCode) { st = await GS.db.get(`students/${studentCode}`); if (!st) throw new Error('Không tìm thấy học sinh'); classId = st.classId; }
    const cls = await GS.db.get(`classes/${classId}`);
    if (!cls) throw new Error('Không tìm thấy lớp');
    const ts = GS.now();
    const id = 'ADJ' + ts.toString(36).toUpperCase() + U.code(3);
    const tx = { id, type: 'manual', typeLabel: 'Điều chỉnh', points, countable: false, classId, className: cls.name, studentCode: st ? st.code : null, fullName: st ? st.fullName : null, username: st ? st.username || null : null, ts, weekKey: U.weekKey(ts), source: 'admin', note: note || '', by: GS.state.user ? GS.state.user.username : null };
    const upd = S.aggregatePaths(tx);
    upd[`transactions/${id}`] = tx;
    await GS.db.update(upd);
  };

  S.resetSeason = async () => {
    const [students, classes] = await Promise.all([GS.db.get('students'), GS.db.get('classes')]);
    const upd = { weekly: null, transactions: null, events: null };
    Object.keys(classes || {}).forEach((c) => { upd[`classes/${c}/points`] = null; upd[`classes/${c}/count`] = null; upd[`classes/${c}/byType`] = null; });
    Object.keys(students || {}).forEach((s) => { upd[`students/${s}/points`] = null; upd[`students/${s}/count`] = null; upd[`students/${s}/byType`] = null; upd[`students/${s}/lastTs`] = null; });
    const bins = await GS.db.get('bins');
    Object.keys(bins || {}).forEach((b) => { upd[`bins/${b}/count`] = null; });
    await GS.db.update(upd);
  };

  /* ---------- Học sinh ---------- */
  S.newStudentCode = (classId, existing) => {
    const prefix = String(GS.state.settings.codePrefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    let code;
    do { code = `${prefix}${classId}-${U.code(4)}`; } while (existing.has(code));
    existing.add(code);
    return code;
  };

  /* rows: [{fullName, className, dob, gender, code?}]
     replace = true → thay toàn bộ danh sách (tài khoản cũ phải đăng ký lại) */
  S.importStudents = async (rows, { replace = false } = {}) => {
    const old = await GS.db.get('students') || {};
    const current = replace ? {} : old;
    const classes = await GS.db.get('classes') || {};
    const existing = new Set(Object.keys(current));
    const seen = new Map(Object.values(current).map((s) => [`${U.normalize(s.fullName)}|${s.classId}`, s.code]));
    const added = {};
    const newClasses = {};
    const result = { added: [], skipped: [] };
    for (const r of rows) {
      const fullName = U.titleCase(r.fullName);
      const className = U.className(r.className);
      const classId = U.classId(className);
      if (!fullName || !classId) { result.skipped.push({ ...r, reason: 'Thiếu họ tên hoặc lớp' }); continue; }
      const key = `${U.normalize(fullName)}|${classId}`;
      if (seen.has(key)) { result.skipped.push({ ...r, reason: 'Trùng họ tên trong cùng lớp' }); continue; }
      let code = r.code ? String(r.code).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') : '';
      if (!code || existing.has(code)) code = S.newStudentCode(classId, existing); else existing.add(code);
      seen.set(key, code);
      const st = { code, fullName, className, classId, dob: r.dob ? String(r.dob) : null, gender: r.gender ? String(r.gender) : null, createdAt: GS.now() };
      added[code] = st;
      if (!classes[classId] && !newClasses[classId]) newClasses[classId] = { name: className, grade: U.gradeOf(className) };
      result.added.push(st);
    }
    const upd = {};
    Object.entries(newClasses).forEach(([id, c]) => { upd[`classes/${id}/id`] = id; upd[`classes/${id}/name`] = c.name; upd[`classes/${id}/grade`] = c.grade; });
    if (replace) {
      Object.values(old).forEach((s) => { if (s.uid) upd[`users/${s.uid}/status`] = 'reset'; });
      await GS.db.set('students', Object.keys(added).length ? added : null);
    } else {
      Object.entries(added).forEach(([code, st]) => { upd[`students/${code}`] = st; });
    }
    if (Object.keys(upd).length) await GS.db.update(upd);
    return result;
  };

  S.addStudent = async ({ fullName, className, dob, gender }) => {
    const r = await S.importStudents([{ fullName, className, dob, gender }]);
    if (!r.added.length) throw new Error(r.skipped[0] ? r.skipped[0].reason : 'Không thêm được học sinh');
    return r.added[0];
  };

  S.updateStudent = async (code, { fullName, className, dob, gender }) => {
    const st = await GS.db.get(`students/${code}`);
    if (!st) throw new Error('Không tìm thấy học sinh');
    const name = U.titleCase(fullName || st.fullName);
    const cName = U.className(className || st.className);
    const classId = U.classId(cName);
    const upd = {
      [`students/${code}/fullName`]: name, [`students/${code}/className`]: cName, [`students/${code}/classId`]: classId,
      [`students/${code}/dob`]: dob || null, [`students/${code}/gender`]: gender || null
    };
    if (!(await GS.db.get(`classes/${classId}`))) { upd[`classes/${classId}/id`] = classId; upd[`classes/${classId}/name`] = cName; upd[`classes/${classId}/grade`] = U.gradeOf(cName); }
    if (st.uid) { upd[`users/${st.uid}/fullName`] = name; upd[`users/${st.uid}/className`] = cName; upd[`users/${st.uid}/classId`] = classId; }
    await GS.db.update(upd);
  };

  S.deleteStudent = async (code) => {
    const st = await GS.db.get(`students/${code}`);
    if (!st) return;
    if (st.uid) await S.deleteAccount(st.uid);
    await GS.db.remove(`students/${code}`);
  };

  /* ---------- Tài khoản ---------- */
  S.setUserStatus = (uid, status) => GS.db.set(`users/${uid}/status`, status);
  S.setRole = async (uid, role) => {
    await GS.db.update({ [`users/${uid}/role`]: role, [`admins/${uid}`]: role === 'admin' ? true : null });
  };
  S.updateAccount = async (uid, { fullName }) => {
    const u = await GS.db.get(`users/${uid}`);
    if (!u) throw new Error('Không tìm thấy tài khoản');
    const upd = { [`users/${uid}/fullName`]: U.titleCase(fullName) };
    if (u.studentCode) upd[`students/${u.studentCode}/fullName`] = U.titleCase(fullName);
    await GS.db.update(upd);
  };
  /* Đặt lại: demo → đặt mật khẩu mới; Firebase → gỡ liên kết để HS đăng ký lại bằng mã cũ */
  S.resetAccount = async (uid, newPassword) => {
    const u = await GS.db.get(`users/${uid}`);
    if (!u) throw new Error('Không tìm thấy tài khoản');
    if (GS.db.mode === 'demo') { await GS.db.adminSetPassword(u.username, newPassword); return 'password'; }
    const upd = { [`users/${uid}/status`]: 'reset' };
    if (u.studentCode) { upd[`students/${u.studentCode}/uid`] = null; upd[`students/${u.studentCode}/username`] = null; upd[`students/${u.studentCode}/registeredAt`] = null; }
    await GS.db.update(upd);
    return 'relink';
  };
  S.deleteAccount = async (uid) => {
    const u = await GS.db.get(`users/${uid}`);
    if (!u) return;
    const upd = { [`users/${uid}`]: null, [`admins/${uid}`]: null };
    if (u.username) upd[`usernames/${u.username}`] = null;
    if (u.studentCode) { upd[`students/${u.studentCode}/uid`] = null; upd[`students/${u.studentCode}/username`] = null; upd[`students/${u.studentCode}/registeredAt`] = null; }
    await GS.db.update(upd);
    if (u.username) await GS.db.removeAuthUser(u.username);
  };
  S.createAdmin = async ({ username, password, fullName }) => {
    username = String(username || '').trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw new Error('Tên đăng nhập gồm 4–20 ký tự: chữ thường không dấu, số, gạch dưới');
    if (String(password || '').length < 6) throw new Error('Mật khẩu cần ít nhất 6 ký tự');
    if (await GS.db.get(`usernames/${username}`)) throw GS.err('auth/username-taken');
    const { uid, email } = await GS.db.createAuthUser(username, password);
    await GS.db.update({
      [`users/${uid}`]: { uid, username, fullName: U.titleCase(fullName) || 'Quản trị viên', role: 'admin', status: 'active', createdAt: GS.now() },
      [`usernames/${username}`]: { uid, email: email || null, studentCode: null },
      [`admins/${uid}`]: true
    });
  };

  /* ---------- Thùng rác ---------- */
  S.saveBin = async ({ id, name, location }) => {
    id = String(id || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!id) throw new Error('Nhập mã thùng (chữ không dấu, số, gạch ngang)');
    await GS.db.update({ [`bins/${id}/id`]: id, [`bins/${id}/name`]: name || id, [`bins/${id}/location`]: location || '' });
    return id;
  };
  S.deleteBin = (id) => GS.db.remove(`bins/${id}`);
  S.binUrl = (id) => {
    let base = GS.USE_EMULATORS ? location.origin + location.pathname + '?firebase=emulator' : String(GS.state.settings.baseUrl || '').trim();
    if (!base) base = location.origin + location.pathname;
    base = base.replace(/#.*$/, '');
    return `${base}#/scan/${encodeURIComponent(id)}`;
  };
  S.binOnline = (b) => !!(b && b.lastSeen && GS.now() - b.lastSeen < 90e3);

  /* ---------- Bảng xếp hạng ---------- */
  S.rankClasses = (classes, weekData) => {
    const list = Object.values(classes || {}).map((c) => {
      const w = weekData ? (weekData[c.id] || {}) : c;
      return { id: c.id, name: c.name, grade: c.grade, points: Number(w.points) || 0, count: Number(w.count) || 0, byType: w.byType || {} };
    });
    list.sort((a, b) => b.points - a.points || b.count - a.count || String(a.name).localeCompare(String(b.name), 'vi', { numeric: true }));
    let rank = 0, prev = null;
    list.forEach((c, i) => { const key = `${c.points}|${c.count}`; if (key !== prev) rank = i + 1; prev = key; c.rank = rank; });
    return list;
  };
})();
