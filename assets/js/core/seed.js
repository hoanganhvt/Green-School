/* Dữ liệu mẫu cho chế độ demo — chỉ chạy khi chưa có dữ liệu trong trình duyệt */
(function () {
  const GS = window.GS;
  const U = GS.util;

  const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'];
  const DEM = ['Văn', 'Thị', 'Minh', 'Ngọc', 'Gia', 'Quốc', 'Thanh', 'Bảo', 'Hoàng', 'Khánh', 'Đức', 'Thu', 'Phương', 'Anh', 'Hữu', 'Tuấn'];
  const TEN = ['An', 'Bình', 'Châu', 'Dũng', 'Giang', 'Hà', 'Hải', 'Hân', 'Hiếu', 'Huy', 'Khoa', 'Linh', 'Long', 'Mai', 'My', 'Nam', 'Ngân', 'Nhi', 'Phúc', 'Quân', 'Quỳnh', 'Sơn', 'Tâm', 'Thảo', 'Trang', 'Trí', 'Tú', 'Uyên', 'Vy', 'Yến', 'Khôi', 'Đạt'];

  /* Bộ sinh số ngẫu nhiên cố định để dữ liệu mẫu ổn định */
  let seed = 20261021;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const incPath = (obj, path, n) => {
    const ks = path.split('/'); let o = obj;
    for (let i = 0; i < ks.length - 1; i++) { o[ks[i]] = o[ks[i]] || {}; o = o[ks[i]]; }
    o[ks[ks.length - 1]] = (o[ks[ks.length - 1]] || 0) + n;
  };

  GS.seed = async (db) => {
    const now = Date.now();
    const t = { settings: { ...GS.DEFAULTS }, classes: {}, weekly: {}, students: {}, users: {}, usernames: {}, admins: {}, bins: {}, events: {}, transactions: {}, _auth: {}, meta: { seeded: true, hasAdmin: true } };
    const classNames = ['10A1', '10A2', '10A3', '11A1', '11A2', '11A3', '12A1', '12A2', '12A3'];
    const activity = { '10A1': 1.25, '10A2': 0.8, '10A3': 0.6, '11A1': 1.05, '11A2': 1.4, '11A3': 0.5, '12A1': 0.95, '12A2': 0.75, '12A3': 1.1 };
    const existing = new Set();
    const registered = [];

    /* Lớp + học sinh */
    for (const cn of classNames) {
      t.classes[cn] = { id: cn, name: cn, grade: U.gradeOf(cn), points: 0, count: 0, byType: {} };
      for (let i = 0; i < 8; i++) {
        const fullName = `${pick(HO)} ${pick(DEM)} ${pick(TEN)}`;
        const code = `${cn}-${U.code(4)}`;
        if (existing.has(code)) continue;
        existing.add(code);
        t.students[code] = { code, fullName, className: cn, classId: cn, gender: rnd() > 0.5 ? 'Nam' : 'Nữ', createdAt: now - 30 * 864e5 };
        if (i < 6) registered.push(code);
      }
    }

    /* Tài khoản: admin + học sinh đã đăng ký */
    t._auth.admin = { uid: 'uadmin', hash: await U.hash('admin123|admin') };
    t.users.uadmin = { uid: 'uadmin', username: 'admin', fullName: 'Cô Lan Anh', role: 'admin', status: 'active', createdAt: now - 40 * 864e5 };
    t.usernames.admin = { uid: 'uadmin', studentCode: null };
    t.admins.uadmin = true;
    const pwHash = {};
    for (let i = 0; i < registered.length; i++) {
      const code = registered[i]; const st = t.students[code];
      const isDemo = i === 0;
      const username = isDemo ? 'hs10a1' : U.normalize(U.shortName(st.fullName)).replace(/\s+/g, '.') + '.' + st.classId.toLowerCase();
      if (t.usernames[username]) continue;
      const uid = 'u' + U.uid(10);
      if (!pwHash[username]) pwHash[username] = await U.hash(`123456|${username}`);
      t._auth[username] = { uid, hash: pwHash[username] };
      t.users[uid] = { uid, username, fullName: st.fullName, className: st.className, classId: st.classId, studentCode: code, role: 'student', status: i === 9 ? 'locked' : 'active', createdAt: now - (20 - (i % 15)) * 864e5 };
      t.usernames[username] = { uid, studentCode: code };
      Object.assign(st, { uid, username, registeredAt: t.users[uid].createdAt });
    }

    /* Thùng rác */
    t.bins = {
      'BIN-01': { id: 'BIN-01', name: 'Thùng sảnh A', location: 'Sảnh tầng 1, dãy A', count: 0, lastSeen: now, demo: true, ip: '192.168.1.41' },
      'BIN-02': { id: 'BIN-02', name: 'Thùng căng tin', location: 'Cạnh quầy nước, căng tin', count: 0, lastSeen: now, demo: true, ip: '192.168.1.42' },
      'BIN-03': { id: 'BIN-03', name: 'Thùng sân bóng', location: 'Góc sân bóng rổ', count: 0, lastSeen: now - 3 * 3600e3, ip: '192.168.1.43' }
    };
    const binIds = Object.keys(t.bins);

    /* Lượt bỏ rác trong 4 tuần gần nhất */
    const rules = GS.DEFAULTS.rules;
    const txs = [];
    const thisWeek = U.weekKey(now);
    for (let w = 3; w >= 0; w--) {
      const wk = U.prevWeek(thisWeek, w);
      const monday = U.weekMonday(wk).getTime() - 7 * 3600e3; // 00:00 thứ 2 giờ VN
      for (const cn of classNames) {
        const members = registered.filter((c) => t.students[c].classId === cn && t.students[c].uid);
        const n = Math.round((14 + rnd() * 16) * activity[cn] * (w === 0 ? 0.75 : 1));
        for (let k = 0; k < n; k++) {
          const day = Math.floor(rnd() * 6);
          const ts = monday + day * 864e5 + (6.5 + rnd() * 10.5) * 3600e3;
          if (ts > now - 60e3) continue;
          const code = pick(members); const st = t.students[code];
          const type = rnd() < 0.62 ? 'plastic' : 'metal';
          txs.push({ ts, code, st, type, binId: pick(binIds.slice(0, 2)) });
        }
      }
    }
    txs.sort((a, b) => a.ts - b.ts);
    txs.forEach((x, i) => {
      const id = 'TX' + Math.floor(x.ts).toString(36).toUpperCase() + String(i).padStart(3, '0');
      const r = rules[x.type];
      const tx = { id, type: x.type, typeLabel: r.label, points: r.points, countable: true, binId: x.binId, classId: x.st.classId, className: x.st.className, studentCode: x.code, fullName: x.st.fullName, username: x.st.username || null, ts: Math.floor(x.ts), weekKey: U.weekKey(x.ts), source: 'esp32' };
      t.transactions[id] = tx;
      [`classes/${tx.classId}`, `weekly/${tx.weekKey}/${tx.classId}`, `students/${tx.studentCode}`].forEach((b) => {
        incPath(t, `${b}/points`, tx.points); incPath(t, `${b}/count`, 1); incPath(t, `${b}/byType/${tx.type}`, 1);
      });
      incPath(t, `bins/${tx.binId}/count`, 1);
      t.students[tx.studentCode].lastTs = tx.ts;
      if (i >= txs.length - 12) t.events[id] = { txId: id, binId: tx.binId, type: tx.type, ts: tx.ts, status: 'processed', points: tx.points, studentCode: tx.studentCode, classId: tx.classId, processedAt: tx.ts + 400 };
    });
    /* Một sự kiện bị từ chối để minh hoạ */
    const rid = 'TXDEMOREJ' + U.code(3);
    t.events[rid] = { txId: rid, binId: 'BIN-02', type: 'paper', ts: now - 25 * 60e3, status: 'rejected', reason: 'Loại rác "paper" chưa có trong quy tắc tính điểm', processedAt: now - 25 * 60e3 + 300 };

    db.tree = t;
    db.save();
  };
})();
