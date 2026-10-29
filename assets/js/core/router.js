/* Bộ định tuyến hash (#/duong-dan) + khung giao diện (layout) */
(function () {
  const GS = window.GS;
  const U = GS.util;
  const routes = [];
  let cleanups = [];
  let renderId = 0;

  /* GS.route('/scan/:bin', handler, { auth: 'user'|'admin', layout: 'public'|'admin'|'bare', title }) */
  GS.route = (pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    routes.push({ pattern, re, keys, handler, opts });
  };

  GS.go = (path, replace = false) => {
    const h = '#' + path;
    if (replace) { history.replaceState(null, '', h); GS.render(); }
    else if (location.hash === h) GS.render();
    else location.hash = h;
  };

  GS.currentPath = () => {
    const raw = (location.hash || '#/').slice(1) || '/';
    const [path, qs] = raw.split('?');
    return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs || '')) };
  };

  GS.render = async () => {
    const id = ++renderId;
    cleanups.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
    cleanups = [];
    const { path, query } = GS.currentPath();
    let match = null, params = {};
    for (const r of routes) {
      const m = path.match(r.re);
      if (m) { match = r; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; }
    }
    if (!match) match = routes.find((r) => r.pattern === '/404');
    const { auth, layout = 'public', title } = match.opts;
    const st = GS.state;
    if (auth && !st.user) { GS.go(`/login?next=${encodeURIComponent(path)}`, true); return; }
    if (auth === 'admin' && !st.isAdmin) { U.toast('Trang này chỉ dành cho quản trị viên', 'warn'); GS.go('/', true); return; }

    const main = GS.layout.mount(layout, path);
    const ctx = {
      params, query, path, el: main,
      cleanup: (fn) => { if (typeof fn === 'function') cleanups.push(fn); },
      alive: () => id === renderId
    };
    document.title = (title ? title + ' | ' : '') + st.settings.appName;
    try {
      const ret = await match.handler(ctx);
      if (typeof ret === 'function') cleanups.push(ret);
    } catch (e) {
      console.error(e);
      main.innerHTML = `<div class="empty-state"><h2>Không tải được trang</h2><p class="muted">${U.esc(GS.svc.errMsg(e))}</p><a class="btn btn-primary" href="#/">Về trang chủ</a></div>`;
    }
    if (!query.keepScroll) window.scrollTo(0, 0);
    const h1 = U.$('h1', main); if (h1 && document.activeElement === document.body) { h1.setAttribute('tabindex', '-1'); }
  };

  /* ---------------- KHUNG GIAO DIỆN ---------------- */
  const L = GS.layout = { current: null };

  L.logo = () => `<span class="logo" aria-hidden="true"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="var(--leaf)" stroke="var(--ink)" stroke-width="2"/><path d="M12 27c8 0 16-5 16-16-10 0-16 6-16 13v3Z" fill="#fff" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/><path d="M12 27c3.5-5 7-8 11-10.5" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"/></svg></span>`;

  L.brand = () => {
    const s = GS.state.settings;
    return `<a class="brand" href="#/">${L.logo()}<span class="brand-text"><b data-app-name>${U.esc(s.appName)}</b><small data-school-name>${U.esc(s.schoolName)}</small></span></a>`;
  };

  L.userChip = () => {
    const u = GS.state.user;
    if (!u) return `<a class="btn btn-ghost btn-sm hide-sm" href="#/login">Đăng nhập</a><a class="btn btn-primary btn-sm" href="#/register">Đăng ký</a>`;
    return `${GS.state.isAdmin ? `<a class="btn btn-ghost btn-sm hide-sm" href="#/admin">${U.icon('shield')}Quản trị</a>` : ''}
      <a class="user-chip" href="#/me" title="Trang cá nhân"><span class="avatar">${U.esc(U.initials(u.fullName))}</span><span class="user-chip-text"><b>${U.esc(U.shortName(u.fullName))}</b><small>${u.className ? 'Lớp ' + U.esc(u.className) : 'Quản trị viên'}</small></span></a>`;
  };

  L.demoBar = () => {
    if (GS.bootError) return `<div class="demo-bar warn">${U.icon('info')}<span>${U.esc(GS.bootError)}</span></div>`;
    if (GS.db.mode !== 'demo') return '';
    let hidden = false; try { hidden = sessionStorage.getItem('gs_hide_demo') === '1'; } catch (e) { /* bỏ qua */ }
    if (hidden) return '';
    return `<div class="demo-bar">${U.icon('info')}<span><b>Chế độ demo:</b> dữ liệu lưu trên trình duyệt này. Thử tài khoản học sinh <code>hs10a1</code> / <code>123456</code>, quản trị <code>admin</code> / <code>admin123</code>.</span><button class="icon-btn" data-hide-demo aria-label="Ẩn thông báo">${U.icon('x')}</button></div>`;
  };

  const navItem = (href, icon, label, path, exact) => {
    const active = exact ? path === href.slice(1) : path.startsWith(href.slice(1));
    return `<a href="${href}" class="${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''}>${U.icon(icon)}<span>${label}</span></a>`;
  };

  L.public = (path) => `
    <a class="skip" href="#main">Bỏ qua tới nội dung</a>
    ${L.demoBar()}
    <header class="site-head"><div class="wrap head-row">
      ${L.brand()}
      <nav class="top-nav" aria-label="Điều hướng chính">
        ${navItem('#/', 'trophy', 'Bảng xếp hạng', path, true)}
        ${navItem('#/scan', 'qr', 'Quét mã thùng', path)}
        ${navItem('#/about', 'leaf', 'Về dự án', path)}
      </nav>
      <div class="head-actions" data-user-slot>${L.userChip()}</div>
    </div></header>
    <main id="main" class="page"></main>
    <footer class="site-foot"><div class="wrap foot-row">
      <span>${L.logo()} <b data-app-name>${U.esc(GS.state.settings.appName)}</b>, ${U.esc(GS.state.settings.seasonName)}</span>
      <span class="muted">Sản phẩm dự thi khoa học kĩ thuật, ${U.esc(GS.state.settings.schoolName)}</span>
    </div></footer>
    <nav class="tabbar" aria-label="Điều hướng nhanh">
      ${navItem('#/', 'trophy', 'Xếp hạng', path, true)}
      ${navItem('#/scan', 'qr', 'Quét mã', path)}
      ${navItem('#/about', 'leaf', 'Dự án', path)}
      ${GS.state.user ? navItem('#/me', 'user', 'Của tôi', path) : navItem('#/login', 'user', 'Đăng nhập', path)}
    </nav>`;

  L.admin = (path) => {
    const u = GS.state.user || {};
    const online = GS.db.mode === 'firebase';
    return `
    <a class="skip" href="#main">Bỏ qua tới nội dung</a>
    <div class="admin">
      <aside class="side">
        <div class="side-top">${L.brand()}</div>
        <nav class="side-nav" aria-label="Quản trị">
          ${navItem('#/admin', 'chart', 'Tổng quan', path, true)}
          ${navItem('#/admin/students', 'users', 'Học sinh & mã', path)}
          ${navItem('#/admin/accounts', 'user', 'Tài khoản', path)}
          ${navItem('#/admin/points', 'trophy', 'Điểm & giao dịch', path)}
          ${navItem('#/admin/bins', 'qr', 'Thùng rác & QR', path)}
          ${navItem('#/admin/settings', 'gear', 'Cài đặt', path)}
        </nav>
        <div class="side-foot">
          <div class="mode-pill ${online ? 'is-fb' : ''}">${U.icon(online ? 'database' : 'info')}<span>${online ? (GS.USE_EMULATORS ? 'Firebase local' : 'Firebase') : 'Chế độ demo'}</span><i class="dot"></i></div>
          <a class="side-link" href="#/">${U.icon('home')}Xem trang học sinh</a>
          <div class="side-user"><span class="avatar">${U.esc(U.initials(u.fullName))}</span><span><b>${U.esc(u.fullName || '')}</b><small>@${U.esc(u.username || '')}</small></span>
          <button class="icon-btn" data-logout title="Đăng xuất" aria-label="Đăng xuất">${U.icon('logout')}</button></div>
        </div>
      </aside>
      <main id="main" class="admin-main"></main>
    </div>`;
  };

  L.bare = () => `${L.demoBar()}<main id="main" class="page page-bare"></main>`;

  L.mount = (layout, path) => {
    const app = U.$('#app');
    app.innerHTML = (L[layout] || L.public)(path);
    app.dataset.layout = layout;
    L.current = layout;
    const hide = U.$('[data-hide-demo]', app);
    if (hide) hide.onclick = () => { try { sessionStorage.setItem('gs_hide_demo', '1'); } catch (e) { /* bỏ qua */ } hide.parentElement.remove(); };
    U.$$('[data-logout]', app).forEach((b) => { b.onclick = async () => { await GS.svc.logout(); U.toast('Đã đăng xuất'); GS.go('/'); }; });
    return U.$('#main', app);
  };

  /* Cập nhật tên app / trạng thái đăng nhập mà không vẽ lại cả trang */
  L.refreshChrome = () => {
    const s = GS.state.settings;
    U.$$('[data-app-name]').forEach((e) => { e.textContent = s.appName; });
    U.$$('[data-school-name]').forEach((e) => { e.textContent = s.schoolName; });
    const slot = U.$('[data-user-slot]'); if (slot) slot.innerHTML = L.userChip();
  };
})();
