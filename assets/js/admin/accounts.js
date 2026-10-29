/* Quản trị: Tài khoản người dùng — khoá/mở, đặt lại, phân quyền, sửa, xoá */
(function () {
  const GS = window.GS;
  const U = GS.util;
  const A = GS.admin;

  A.route('/admin/accounts', (ctx) => {
    const demo = GS.db.mode === 'demo';
    ctx.el.innerHTML = A.head('Tài khoản', 'Tài khoản học sinh tự tạo bằng mã học sinh, cùng các tài khoản quản trị.',
      `<button class="btn btn-primary" data-new-admin>${U.icon('plus')}Tạo tài khoản quản trị</button>`) + `
      <div class="filters">
        <label class="search">${U.icon('search')}<input type="search" placeholder="Tìm theo tên, tên đăng nhập, mã" data-q aria-label="Tìm tài khoản"></label>
        <select data-cls aria-label="Lọc theo lớp"></select>
        <select data-role aria-label="Lọc theo vai trò"><option value="">Mọi vai trò</option><option value="student">Học sinh</option><option value="admin">Quản trị</option></select>
        <select data-status aria-label="Lọc theo trạng thái"><option value="">Mọi trạng thái</option><option value="active">Đang hoạt động</option><option value="locked">Đã khoá</option><option value="reset">Chờ đăng ký lại</option></select>
        <span class="muted small" data-count></span>
      </div>
      <div class="card flush"><div class="table-wrap"><table class="tbl">
        <thead><tr><th>Tài khoản</th><th>Lớp</th><th>Mã học sinh</th><th>Vai trò</th><th>Trạng thái</th><th class="r">Điểm góp</th><th>Ngày tạo</th><th class="r">Thao tác</th></tr></thead>
        <tbody data-rows></tbody></table></div></div>`;
    const $ = (s) => U.$(s, ctx.el);
    let users = {}, students = {}, classes = {};

    const statusPill = (s) => s === 'locked' ? '<span class="pill pill-bad">Đã khoá</span>' : s === 'reset' ? '<span class="pill pill-warn">Chờ đăng ký lại</span>' : '<span class="pill pill-ok">Hoạt động</span>';
    const paint = () => {
      const q = U.normalize($('[data-q]').value), c = $('[data-cls]').value, r = $('[data-role]').value, st = $('[data-status]').value;
      const list = Object.values(users).filter((u) => (!c || u.classId === c) && (!r || (u.role || 'student') === r) && (!st || (u.status || 'active') === st)
        && (!q || U.normalize(`${u.fullName} ${u.username} ${u.studentCode || ''}`).includes(q)))
        .sort((a, b) => (a.role === 'admin' ? -1 : 0) - (b.role === 'admin' ? -1 : 0) || String(a.className || '').localeCompare(String(b.className || ''), 'vi', { numeric: true }) || String(a.fullName).localeCompare(String(b.fullName), 'vi'));
      $('[data-count]').textContent = `${U.fmt(list.length)} tài khoản`;
      const me = GS.state.uid;
      $('[data-rows]').innerHTML = list.map((u) => {
        const stu = u.studentCode ? students[u.studentCode] : null;
        const isMe = u.uid === me;
        return `<tr class="${u.status === 'locked' ? 'dim' : ''}">
          <td><div class="who"><span class="avatar sm">${U.esc(U.initials(u.fullName))}</span><span><b>${U.esc(u.fullName)}</b><small class="muted block">@${U.esc(u.username)}${isMe ? ' (bạn)' : ''}</small></span></div></td>
          <td>${U.esc(u.className || '')}</td>
          <td>${u.studentCode ? `<code class="code">${U.esc(u.studentCode)}</code>` : '<span class="muted">Không có</span>'}</td>
          <td>${u.role === 'admin' ? '<span class="pill pill-leaf">Quản trị</span>' : 'Học sinh'}</td>
          <td>${statusPill(u.status)}</td>
          <td class="r">${stu ? `<b>${U.fmt(stu.points)}</b>` : '<span class="muted">-</span>'}</td>
          <td class="nowrap">${u.createdAt ? new Date(u.createdAt).toLocaleDateString('vi-VN') : ''}</td>
          <td class="r nowrap">
            <button class="icon-btn" data-a="edit" data-u="${u.uid}" title="Sửa thông tin" aria-label="Sửa thông tin">${U.icon('edit')}</button>
            ${isMe ? '' : `<button class="icon-btn" data-a="${u.status === 'locked' ? 'unlock' : 'lock'}" data-u="${u.uid}" title="${u.status === 'locked' ? 'Mở khoá' : 'Khoá tài khoản'}" aria-label="${u.status === 'locked' ? 'Mở khoá' : 'Khoá tài khoản'}">${U.icon(u.status === 'locked' ? 'unlock' : 'lock')}</button>
            <button class="icon-btn" data-a="reset" data-u="${u.uid}" title="Đặt lại mật khẩu" aria-label="Đặt lại mật khẩu">${U.icon('key')}</button>
            <button class="icon-btn" data-a="role" data-u="${u.uid}" title="${u.role === 'admin' ? 'Gỡ quyền quản trị' : 'Cấp quyền quản trị'}" aria-label="Đổi vai trò">${U.icon('shield')}</button>
            <button class="icon-btn danger" data-a="del" data-u="${u.uid}" title="Xoá tài khoản" aria-label="Xoá tài khoản">${U.icon('trash')}</button>`}
          </td></tr>`;
      }).join('') || '<tr><td colspan="8" class="empty-row">Chưa có tài khoản khớp bộ lọc. Học sinh tự đăng ký bằng mã ở trang Đăng ký.</td></tr>';
    };

    ctx.cleanup(GS.db.on('users', (v) => { users = v || {}; paint(); }));
    ctx.cleanup(GS.db.on('students', (v) => { students = v || {}; paint(); }));
    ctx.cleanup(GS.db.on('classes', (v) => { classes = v || {}; const k = $('[data-cls]').value; $('[data-cls]').innerHTML = A.classOptions(classes, k, 'Tất cả lớp'); }));
    ['[data-q]', '[data-cls]', '[data-role]', '[data-status]'].forEach((s) => $(s).addEventListener(s === '[data-q]' ? 'input' : 'change', paint));

    $('[data-new-admin]').onclick = () => U.modal({
      title: 'Tạo tài khoản quản trị',
      body: `<label class="field"><span>Họ và tên</span><input name="fullName" required placeholder="Thầy Nguyễn Văn Bình"></label>
             <label class="field"><span>Tên đăng nhập</span><input name="username" required autocapitalize="none" spellcheck="false"></label>
             <label class="field"><span>Mật khẩu</span><input name="password" type="text" required minlength="6" value="${U.code(8).toLowerCase()}"><small class="hint">Gửi mật khẩu này cho người dùng, họ có thể đổi sau khi đăng nhập.</small></label>`,
      actions: [{ label: 'Huỷ' }, { label: 'Tạo tài khoản', kind: 'primary', submit: true }],
      onSubmit: async (f) => { try { await GS.svc.createAdmin(U.formData(f)); } catch (e) { throw new Error(GS.svc.errMsg(e)); } U.toast('Đã tạo tài khoản quản trị'); }
    });

    ctx.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const u = users[b.dataset.u]; if (!u) return;
      const a = b.dataset.a;
      try {
        if (a === 'edit') {
          await U.modal({ title: `Sửa @${u.username}`,
            body: `<label class="field"><span>Họ và tên</span><input name="fullName" required value="${U.esc(u.fullName)}"></label>
                   ${u.studentCode ? '<p class="hint">Muốn đổi lớp, sửa ở trang Học sinh & mã. Tài khoản sẽ tự cập nhật theo.</p>' : ''}`,
            actions: [{ label: 'Huỷ' }, { label: 'Lưu thay đổi', kind: 'primary', submit: true }],
            onSubmit: async (f) => { await GS.svc.updateAccount(u.uid, U.formData(f)); U.toast('Đã lưu thay đổi'); } });
        }
        if (a === 'lock' && await U.confirm('Khoá tài khoản?', `@${U.esc(u.username)} sẽ không đăng nhập và tích điểm được cho tới khi mở khoá.`, { okLabel: 'Khoá tài khoản', danger: true })) { await GS.svc.setUserStatus(u.uid, 'locked'); U.toast('Đã khoá tài khoản'); }
        if (a === 'unlock') { await GS.svc.setUserStatus(u.uid, 'active'); U.toast('Đã mở khoá tài khoản'); }
        if (a === 'role') {
          const toAdmin = u.role !== 'admin';
          if (await U.confirm(toAdmin ? 'Cấp quyền quản trị?' : 'Gỡ quyền quản trị?', toAdmin ? `@${U.esc(u.username)} sẽ vào được trang quản trị, sửa điểm và tài khoản.` : `@${U.esc(u.username)} sẽ trở lại tài khoản thường.`, { okLabel: toAdmin ? 'Cấp quyền' : 'Gỡ quyền', danger: toAdmin })) {
            await GS.svc.setRole(u.uid, toAdmin ? 'admin' : 'student'); U.toast(toAdmin ? 'Đã cấp quyền quản trị' : 'Đã gỡ quyền quản trị');
          }
        }
        if (a === 'reset') {
          if (demo) {
            const pw = U.code(6).toLowerCase();
            await U.modal({ title: `Đặt lại mật khẩu @${u.username}`, body: `<label class="field"><span>Mật khẩu mới</span><input name="pw" required minlength="6" value="${pw}"></label><p class="hint">Gửi mật khẩu mới cho học sinh. Bạn ấy có thể đổi lại trong trang Của tôi.</p>`,
              actions: [{ label: 'Huỷ' }, { label: 'Đặt mật khẩu mới', kind: 'primary', submit: true }],
              onSubmit: async (f) => { if (f.pw.value.length < 6) throw new Error('Mật khẩu cần ít nhất 6 ký tự'); await GS.svc.resetAccount(u.uid, f.pw.value); U.toast('Đã đặt mật khẩu mới'); } });
          } else if (await U.confirm('Đặt lại tài khoản?', `Tài khoản @${U.esc(u.username)} sẽ được gỡ khỏi mã học sinh. Học sinh vào trang Đăng ký, dùng lại mã <b>${U.esc(u.studentCode || '')}</b> để tạo mật khẩu mới (có thể giữ tên đăng nhập cũ). Điểm đã góp vẫn giữ nguyên.`, { okLabel: 'Đặt lại' })) {
            await GS.svc.resetAccount(u.uid); U.toast('Học sinh có thể đăng ký lại bằng mã cũ');
          }
        }
        if (a === 'del' && await U.confirm('Xoá tài khoản?', `Xoá @${U.esc(u.username)}. ${u.studentCode ? 'Mã học sinh được giải phóng để đăng ký lại. ' : ''}Điểm đã góp cho lớp vẫn giữ.`, { okLabel: 'Xoá tài khoản', danger: true })) {
          await GS.svc.deleteAccount(u.uid); U.toast('Đã xoá tài khoản');
        }
      } catch (err) { U.toast(GS.svc.errMsg(err), 'err'); }
    });
  }, 'Tài khoản');
})();
