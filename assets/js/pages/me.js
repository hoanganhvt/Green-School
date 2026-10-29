/* Trang cá nhân: điểm của tôi, hạng của lớp, lịch sử, đổi mật khẩu */
(function () {
  const GS = window.GS;
  const U = GS.util;

  GS.route('/me', (ctx) => {
    const u = GS.state.user;
    if (!u.studentCode) {
      ctx.el.innerHTML = `<section class="wrap me"><div class="me-card"><span class="avatar avatar-lg">${U.esc(U.initials(u.fullName))}</span><div><h1>${U.esc(u.fullName)}</h1><p class="muted">@${U.esc(u.username)}, quản trị viên</p></div></div>
        <div class="row-btns"><a class="btn btn-primary" href="#/admin">${U.icon('shield')}Vào trang quản trị</a><button class="btn btn-ghost" data-pw>${U.icon('key')}Đổi mật khẩu</button><button class="btn btn-ghost" data-logout>${U.icon('logout')}Đăng xuất</button></div></section>`;
      bindCommon(ctx);
      return;
    }
    const wk = U.weekKey(GS.now());
    ctx.el.innerHTML = `
      <section class="wrap me">
        <div class="me-card">
          <span class="avatar avatar-lg">${U.esc(U.initials(u.fullName))}</span>
          <div class="grow"><h1>${U.esc(u.fullName)}</h1>
            <p class="muted">Lớp ${U.esc(u.className)}, @${U.esc(u.username)}</p>
            <p class="code-line">Mã học sinh <code>${U.esc(u.studentCode)}</code></p></div>
          <a class="btn btn-primary hide-sm" href="#/scan">${U.icon('qr')}Quét mã thùng</a>
        </div>
        <div class="stats" data-stats></div>
        <div class="split section">
          <div class="panel"><div class="panel-head"><h2>Lịch sử bỏ rác</h2></div><ul class="drops" data-hist><li class="muted">Đang tải…</li></ul></div>
          <div class="panel"><div class="panel-head"><h2>Lớp ${U.esc(u.className)} tuần này</h2></div><div data-class></div>
            <div class="row-btns section-sm"><button class="btn btn-ghost btn-sm" data-pw>${U.icon('key')}Đổi mật khẩu</button><button class="btn btn-ghost btn-sm" data-logout>${U.icon('logout')}Đăng xuất</button></div></div>
        </div>
      </section>`;
    bindCommon(ctx);
    const $ = (s) => U.$(s, ctx.el);
    let classes = {}, week = {};

    const paintStats = () => {
      const st = GS.state.student || {};
      const ranked = GS.svc.rankClasses(classes, week);
      const mine = ranked.find((c) => c.id === u.classId) || { rank: '-', points: 0, count: 0, byType: {} };
      $('[data-stats]').innerHTML = `
        <div class="stat stat-leaf"><small>Điểm bạn góp cho lớp</small><b>${U.fmt(st.points)}</b><span>${U.fmt(st.count)} lượt bỏ rác</span></div>
        <div class="stat"><small>Hạng của lớp tuần này</small><b>#${mine.rank}</b><span>trên ${ranked.length} lớp</span></div>
        <div class="stat"><small>Điểm của lớp tuần này</small><b>${U.fmt(mine.points)}</b><span>${U.fmt(mine.count)} lượt</span></div>`;
      const ahead = ranked.find((c) => c.rank === mine.rank - 1);
      const gap = ahead ? ahead.points - mine.points : 0;
      $('[data-class]').innerHTML = `
        <div class="class-week">${GS.ui.stackBar(mine.byType, Math.max(1, mine.count))}
          <div class="legend">${GS.ui.ruleList().map((r) => `<span><i style="background:${r.color}"></i>${U.esc(r.label)}: ${U.fmt(mine.byType[r.key] || 0)}</span>`).join('')}</div></div>
        <p class="nudge">${mine.rank === 1 && mine.points ? 'Lớp bạn đang dẫn đầu. Giữ vững phong độ nhé!' : ahead ? `Còn <b>${U.fmt(gap + 1)} điểm</b> nữa là vượt lớp ${U.esc(ahead.name)} lên hạng ${ahead.rank}.` : 'Bỏ rác đúng thùng để lớp bạn có điểm đầu tiên tuần này.'}</p>`;
    };

    ctx.cleanup(GS.db.on('classes', (v) => { classes = v || {}; paintStats(); }));
    ctx.cleanup(GS.db.on(`weekly/${wk}`, (v) => { week = v || {}; paintStats(); }));
    ctx.cleanup(GS.bus.on('auth', paintStats));
    ctx.cleanup(GS.db.onQuery('transactions', { orderBy: 'studentCode', equalTo: u.studentCode, limitToLast: 40 }, (list) => {
      const items = list.sort((a, b) => b.ts - a.ts);
      $('[data-hist]').innerHTML = items.length ? items.map((t) => `<li class="${t.revoked ? 'rej' : ''}">
        <span class="feed-ic" style="--c:${GS.ui.ruleColor(t.type)}">${U.icon(GS.ui.typeIcon(t.type))}</span>
        <span>${U.esc(t.typeLabel || GS.ui.ruleLabel(t.type))}${t.note ? `: ${U.esc(t.note)}` : ''}<small>${U.dateTime(t.ts)}${t.binId ? `, ${U.esc(t.binId)}` : ''}${t.revoked ? ', đã huỷ' : ''}</small></span>
        <b class="${t.points >= 0 ? 'plus' : 'minus'}">${t.points >= 0 ? '+' : ''}${t.points}</b></li>`).join('')
        : `<li class="empty-row">Bạn chưa có lượt nào. Quét mã trên thùng rác để bắt đầu.</li>`;
    }));
  }, { auth: 'user', title: 'Của tôi' });

  function bindCommon(ctx) {
    U.$$('[data-logout]', ctx.el).forEach((b) => { b.onclick = async () => { await GS.svc.logout(); U.toast('Đã đăng xuất'); GS.go('/'); }; });
    U.$$('[data-pw]', ctx.el).forEach((b) => {
      b.onclick = () => U.modal({
        title: 'Đổi mật khẩu',
        body: `<label class="field"><span>Mật khẩu hiện tại</span><input name="old" type="password" autocomplete="current-password" required></label>
               <label class="field"><span>Mật khẩu mới</span><input name="pw" type="password" autocomplete="new-password" minlength="6" required></label>
               <label class="field"><span>Nhập lại mật khẩu mới</span><input name="pw2" type="password" autocomplete="new-password" required></label>`,
        actions: [{ label: 'Huỷ', value: null }, { label: 'Đổi mật khẩu', kind: 'primary', submit: true }],
        onSubmit: async (f) => {
          if (f.pw.value !== f.pw2.value) throw new Error('Hai mật khẩu mới chưa khớp nhau');
          try { await GS.svc.changePassword(f.old.value, f.pw.value); } catch (e) { throw new Error(GS.svc.errMsg(e)); }
          U.toast('Đã đổi mật khẩu');
        }
      });
    });
  }
})();
