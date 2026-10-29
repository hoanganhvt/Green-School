/* Tiện ích dùng chung: DOM, định dạng, tuần, mã ngẫu nhiên, toast, hộp thoại */
(function () {
  const GS = window.GS = window.GS || {};
  const U = GS.util = {};

  U.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.$ = (sel, root = document) => root.querySelector(sel);
  U.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  U.fmt = (n) => (Number(n) || 0).toLocaleString('vi-VN');
  U.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* Chuẩn hoá chuỗi để so sánh: bỏ dấu, viết thường, gộp khoảng trắng */
  U.normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();

  /* Chuẩn hoá tên người: viết hoa chữ cái đầu mỗi từ */
  U.titleCase = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi')
    .split(' ').map((w) => w.charAt(0).toLocaleUpperCase('vi') + w.slice(1)).join(' ');

  /* "10 a1" → "10A1" — dùng làm khoá lớp trong CSDL */
  U.classId = (name) => U.normalize(name).toUpperCase().replace(/[^A-Z0-9]/g, '');
  U.className = (name) => String(name || '').trim().replace(/\s+/g, '').toUpperCase();
  U.gradeOf = (name) => { const m = String(name || '').match(/^(\d{1,2})/); return m ? Number(m[1]) : null; };

  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  U.code = (n = 4) => {
    let s = '';
    const arr = (window.crypto && crypto.getRandomValues) ? crypto.getRandomValues(new Uint32Array(n)) : Array.from({ length: n }, () => Math.random() * 1e9);
    for (let i = 0; i < n; i++) s += ALPHA[arr[i] % ALPHA.length];
    return s;
  };
  U.uid = (n = 12) => U.code(n).toLowerCase();
  U.txId = () => 'TX' + Date.now().toString(36).toUpperCase() + U.code(4);

  /* Băm mật khẩu cho chế độ demo (Firebase dùng Firebase Auth) */
  U.hash = async (str) => {
    try {
      if (window.crypto && crypto.subtle) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) { /* dùng phương án dự phòng */ }
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 'f' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  };

  /* ---------- Thời gian (giờ Việt Nam, UTC+7) ---------- */
  const VN = 7 * 3600e3;
  U.weekKey = (ts = Date.now()) => {
    const d = new Date(ts + VN);
    const day = (d.getUTCDay() + 6) % 7; // Thứ 2 = 0
    const thu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
    const y = thu.getUTCFullYear();
    const jan4 = new Date(Date.UTC(y, 0, 4));
    const w = 1 + Math.round(((thu - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
    return `${y}-W${String(w).padStart(2, '0')}`;
  };
  U.weekMonday = (key) => {
    const [y, w] = key.split('-W').map(Number);
    const jan4 = new Date(Date.UTC(y, 0, 4));
    const mon1 = Date.UTC(y, 0, 4 - ((jan4.getUTCDay() + 6) % 7));
    return new Date(mon1 + (w - 1) * 7 * 864e5); // ngày theo UTC = ngày VN
  };
  U.weekLabel = (key) => {
    if (!key) return '';
    const mon = U.weekMonday(key);
    const sun = new Date(mon.getTime() + 6 * 864e5);
    const f = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return `${f(mon)} – ${f(sun)}`;
  };
  U.weekNo = (key) => Number(String(key).split('-W')[1] || 0);
  U.prevWeek = (key, n = 1) => U.weekKey(U.weekMonday(key).getTime() - VN + 12 * 3600e3 - n * 7 * 864e5);

  U.dateTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
  };
  U.timeAgo = (ts) => {
    if (!ts) return '';
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 10) return 'vừa xong';
    if (s < 60) return `${s} giây trước`;
    const m = Math.round(s / 60); if (m < 60) return `${m} phút trước`;
    const h = Math.round(m / 60); if (h < 24) return `${h} giờ trước`;
    const d = Math.round(h / 24); if (d < 8) return `${d} ngày trước`;
    return U.dateTime(ts);
  };
  U.mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  U.debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  U.initials = (name) => { const p = String(name || '?').trim().split(/\s+/); return (p.length > 1 ? p[p.length - 2][0] + p[p.length - 1][0] : p[0].slice(0, 2)).toUpperCase(); };
  U.shortName = (name) => { const p = String(name || '').trim().split(/\s+/); return p.length > 2 ? p.slice(-2).join(' ') : p.join(' '); };

  /* ---------- Tải script ngoài khi cần ---------- */
  const scriptCache = {};
  U.loadScript = (src) => scriptCache[src] || (scriptCache[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => { delete scriptCache[src]; reject(new Error('Không tải được thư viện: ' + src)); };
    document.head.appendChild(s);
  }));
  U.libs = {
    xlsx: () => U.loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js').then(() => window.XLSX),
    qr: () => U.loadScript('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js').then(() => window.qrcode),
    jsqr: () => U.loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js').then(() => window.jsQR)
  };

  /* ---------- Biểu tượng (SVG nét) ---------- */
  const P = {
    leaf: '<path d="M5 19c6 0 14-4 14-15C10 4 5 9 5 15v4Z"/><path d="M5 19c3-5 6-8 10-10"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8.5 20h7M10 17h4"/>',
    qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.8c2 .7 3.3 2.4 4 5.2"/>',
    logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="2"/><path d="M7 14h10v6H7z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="M13.5 6.5l4 4"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-8"/>',
    bin: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1.2 13h9.6L18 7"/><path d="M10 11v5M14 11v5"/>',
    bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6l1-7Z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    wifi: '<path d="M3 9a13 13 0 0 1 18 0M6 12.5a8.5 8.5 0 0 1 12 0M9 16a4 4 0 0 1 6 0"/><circle cx="12" cy="19" r="1"/>',
    shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"/><path d="M9 12l2 2 4-4"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4.5M20 20v-4h-4"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    bottle: '<path d="M10 3h4v3l2 3v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9l2-3V3Z"/><path d="M8 13h8"/>',
    can: '<rect x="7" y="4" width="10" height="16" rx="2"/><path d="M7 8h10M7 16h10"/>',
    send: '<path d="M4 12l16-8-6 16-3-7-7-1Z"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
    database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>'
  };
  U.icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.leaf}</svg>`;

  /* ---------- Toast ---------- */
  U.toast = (msg, type = 'ok', ms = 3200) => {
    let wrap = U.$('#toasts');
    if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toasts'; wrap.setAttribute('role', 'status'); wrap.setAttribute('aria-live', 'polite'); document.body.appendChild(wrap); }
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = `${U.icon(type === 'err' ? 'x' : type === 'warn' ? 'info' : 'check')}<span>${U.esc(msg)}</span>`;
    wrap.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
  };

  /* ---------- Hộp thoại ----------
     U.modal({ title, body(html), actions:[{label, kind, value}], onOpen(el) }) → Promise<value> */
  U.modal = ({ title, body = '', actions = [{ label: 'Đóng', value: null }], wide = false, onOpen, onSubmit } = {}) => new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const ov = document.createElement('div');
    ov.className = 'modal-ov';
    ov.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${U.esc(title)}">
      <div class="modal-head"><h3>${U.esc(title)}</h3><button class="icon-btn" data-close aria-label="Đóng">${U.icon('x')}</button></div>
      <form class="modal-body" novalidate>${body}<div class="modal-actions">${actions.map((a, i) =>
        `<button type="${a.submit ? 'submit' : 'button'}" class="btn ${a.kind ? 'btn-' + a.kind : 'btn-ghost'}" data-i="${i}">${a.label}</button>`).join('')}</div></form></div>`;
    document.body.appendChild(ov);
    document.body.classList.add('no-scroll');
    const form = U.$('form', ov);
    const close = (v) => { ov.classList.add('out'); document.body.classList.remove('no-scroll'); setTimeout(() => ov.remove(), 180); document.removeEventListener('keydown', onKey); prevFocus && prevFocus.focus && prevFocus.focus(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(null); });
    U.$('[data-close]', ov).onclick = () => close(null);
    U.$$('.modal-actions button', ov).forEach((b) => {
      const a = actions[Number(b.dataset.i)];
      if (!a.submit) b.onclick = () => close(a.value);
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const a = actions.find((x) => x.submit);
      if (onSubmit) {
        const btn = U.$('button[type=submit]', form); btn && (btn.disabled = true);
        try { const r = await onSubmit(form); if (r !== false) close(r === undefined ? a.value : r); }
        catch (err) { U.toast(err.message || String(err), 'err'); }
        finally { btn && (btn.disabled = false); }
      } else close(a ? a.value : true);
    });
    onOpen && onOpen(ov);
    setTimeout(() => { const f = U.$('input,select,textarea', form) || U.$('.modal-actions button:last-child', form); f && f.focus(); }, 30);
  });

  U.confirm = (title, message, { okLabel = 'Đồng ý', danger = false, typeText = '' } = {}) => U.modal({
    title,
    body: `<p class="muted">${message}</p>${typeText ? `<label class="field"><span>Gõ <b>${U.esc(typeText)}</b> để xác nhận</span><input name="confirm" autocomplete="off"></label>` : ''}`,
    actions: [{ label: 'Huỷ', value: false }, { label: okLabel, kind: danger ? 'danger' : 'primary', submit: true, value: true }],
    onSubmit: typeText ? (f) => { if (f.confirm.value.trim() !== typeText) { U.toast('Chuỗi xác nhận chưa đúng', 'err'); return false; } return true; } : undefined
  });

  U.formData = (form) => Object.fromEntries(new FormData(form).entries());

  /* Tải file text */
  U.download = (filename, content, type = 'application/json') => {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  /* In một vùng HTML riêng */
  U.print = (html, title = '') => {
    let root = U.$('#print-root');
    if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
    root.innerHTML = html;
    document.body.classList.add('printing');
    const old = document.title; if (title) document.title = title;
    const done = () => { document.body.classList.remove('printing'); root.innerHTML = ''; document.title = old; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { window.print(); setTimeout(() => { if (document.body.classList.contains('printing')) done(); }, 1500); }, 250);
  };
})();
