/* Đăng nhập, đăng ký bằng mã học sinh, thiết lập admin đầu tiên, giới thiệu dự án, 404 */
(function () {
  const GS = window.GS;
  const U = GS.util;

  const pwField = (name, label, autocomplete, hint = '') => `
    <label class="field"><span>${label}</span>
      <span class="pw"><input name="${name}" type="password" autocomplete="${autocomplete}" required minlength="6">
      <button type="button" class="icon-btn" data-toggle-pw aria-label="Hiện mật khẩu">${U.icon('eye')}</button></span>
      ${hint ? `<small class="hint">${hint}</small>` : ''}
    </label>`;

  const bindPw = (root) => U.$$('[data-toggle-pw]', root).forEach((b) => {
    b.onclick = () => { const i = b.previousElementSibling; i.type = i.type === 'password' ? 'text' : 'password'; b.setAttribute('aria-label', i.type === 'password' ? 'Hiện mật khẩu' : 'Ẩn mật khẩu'); };
  });

  const authShell = (title, sub, form, aside) => `
    <section class="wrap auth">
      <div class="auth-card">
        <div class="auth-main">
          <h1>${title}</h1>
          <p class="muted">${sub}</p>
          ${form}
        </div>
        <aside class="auth-aside">${aside}</aside>
      </div>
    </section>`;

  const setBusy = (form, busy) => { const b = U.$('button[type=submit]', form); if (b) { b.disabled = busy; b.classList.toggle('is-busy', busy); } };
  const showErr = (form, msg) => { const e = U.$('[data-err]', form); e.textContent = msg || ''; e.hidden = !msg; };

  /* ---------------- Đăng nhập ---------------- */
  GS.route('/login', (ctx) => {
    const next = ctx.query.next || '';
    if (GS.state.user) { GS.go(next || (GS.state.isAdmin ? '/admin' : '/me'), true); return; }
    const scanning = next.startsWith('/scan/');
    ctx.el.innerHTML = authShell(
      scanning ? 'Đăng nhập để tích điểm' : 'Đăng nhập',
      scanning ? `Bạn vừa quét thùng <b>${U.esc(decodeURIComponent(next.split('/')[2] || ''))}</b>. Đăng nhập xong là có thể bỏ rác ngay.` : 'Dùng tên đăng nhập và mật khẩu bạn đã tạo.',
      `<form class="form" novalidate data-form>
        <label class="field"><span>Tên đăng nhập</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
        ${pwField('password', 'Mật khẩu', 'current-password')}
        <p class="form-err" data-err hidden role="alert"></p>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Đăng nhập</button>
        <p class="form-alt">Chưa có tài khoản? <a href="#/register${next ? '?next=' + encodeURIComponent(next) : ''}">Đăng ký bằng mã học sinh</a></p>
      </form>`,
      `<div class="aside-art">${GS.layout.logo()}</div>
       <h2>Quên mật khẩu?</h2>
       <p>Nhờ thầy cô quản trị đặt lại tài khoản. Điểm bạn đã góp cho lớp vẫn được giữ nguyên.</p>
       ${GS.db.mode === 'demo' ? '<p class="aside-note">Tài khoản thử: <code>hs10a1</code> / <code>123456</code><br>Quản trị: <code>admin</code> / <code>admin123</code></p>' : ''}`
    );
    const form = U.$('[data-form]', ctx.el);
    bindPw(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); showErr(form, ''); setBusy(form, true);
      const d = U.formData(form);
      try {
        const u = await GS.svc.login(d.username, d.password);
        U.toast(`Chào ${U.shortName(u.fullName)}!`);
        GS.go(next || (u.role === 'admin' ? '/admin' : '/me'));
      } catch (err) { showErr(form, GS.svc.errMsg(err)); }
      finally { setBusy(form, false); }
    });
  }, { title: 'Đăng nhập' });

  /* ---------------- Đăng ký ---------------- */
  GS.route('/register', async (ctx) => {
    const next = ctx.query.next || '';
    if (GS.state.user) { GS.go('/me', true); return; }
    ctx.el.innerHTML = authShell(
      'Tạo tài khoản',
      'Mỗi học sinh có một mã riêng do nhà trường cấp. Điền đúng họ tên và lớp giống trên phiếu để kích hoạt.',
      `<form class="form" novalidate data-form>
        <label class="field"><span>Mã học sinh</span>
          <input name="studentCode" required autocapitalize="characters" spellcheck="false" placeholder="Ví dụ: 10A1-K7Q2" value="${U.esc(ctx.query.code || '')}">
          <small class="hint" data-code-hint>In trên phiếu thầy cô phát cho lớp.</small></label>
        <label class="field"><span>Họ và tên</span><input name="fullName" required autocomplete="name" placeholder="Nguyễn Văn An"></label>
        <label class="field"><span>Lớp</span><select name="className" required data-classes><option value="">Đang tải danh sách lớp…</option></select></label>
        <hr class="soft">
        <label class="field"><span>Tên đăng nhập</span><input name="username" required autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="an.nguyen">
          <small class="hint">4–20 ký tự: chữ thường không dấu, số hoặc gạch dưới.</small></label>
        <div class="grid-2">
          ${pwField('password', 'Mật khẩu', 'new-password', 'Ít nhất 6 ký tự.')}
          ${pwField('password2', 'Nhập lại mật khẩu', 'new-password')}
        </div>
        <p class="form-err" data-err hidden role="alert"></p>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Tạo tài khoản</button>
        <p class="form-alt">Đã có tài khoản? <a href="#/login${next ? '?next=' + encodeURIComponent(next) : ''}">Đăng nhập</a></p>
      </form>`,
      `<div class="aside-art">${GS.layout.logo()}</div>
       <h2>Không cần email</h2>
       <p>Bạn chỉ cần mã học sinh, họ tên và lớp. Sau khi tạo, đăng nhập bằng tên đăng nhập và mật khẩu của riêng bạn.</p>
       <p>Mỗi mã học sinh chỉ đăng ký được một tài khoản.</p>`
    );
    const form = U.$('[data-form]', ctx.el);
    bindPw(form);
    const classes = await GS.db.get('classes') || {};
    const list = Object.values(classes).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi', { numeric: true }));
    U.$('[data-classes]', form).innerHTML = `<option value="">Chọn lớp</option>` + list.map((c) => `<option value="${U.esc(c.name)}">${U.esc(c.name)}</option>`).join('');

    const codeInput = form.studentCode;
    const hint = U.$('[data-code-hint]', form);
    codeInput.addEventListener('blur', async () => {
      const code = codeInput.value.trim().toUpperCase();
      if (!code) return;
      codeInput.value = code;
      const st = await GS.db.get(`students/${code}`).catch(() => null);
      hint.className = 'hint ' + (st ? (st.uid ? 'bad' : 'good') : 'bad');
      hint.textContent = st ? (st.uid ? 'Mã này đã được dùng để đăng ký.' : 'Mã hợp lệ. Điền họ tên và lớp giống trên phiếu.') : 'Không tìm thấy mã này.';
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); showErr(form, ''); setBusy(form, true);
      try {
        await GS.svc.register(U.formData(form));
        U.toast('Tạo tài khoản thành công');
        GS.go(next || '/me');
      } catch (err) { showErr(form, GS.svc.errMsg(err)); }
      finally { setBusy(form, false); }
    });
  }, { title: 'Đăng ký' });

  /* ---------------- Thiết lập admin đầu tiên (Firebase) ---------------- */
  GS.route('/setup', async (ctx) => {
    const has = await GS.db.get('meta/hasAdmin').catch(() => null);
    if (has || GS.db.mode === 'demo') {
      ctx.el.innerHTML = `<div class="wrap empty-state"><h1>Hệ thống đã sẵn sàng</h1><p class="muted">${GS.db.mode === 'demo' ? 'Chế độ demo đã có sẵn tài khoản quản trị admin / admin123.' : 'Đã có quản trị viên. Hãy đăng nhập bằng tài khoản quản trị.'}</p><a class="btn btn-primary" href="#/login">Đăng nhập</a></div>`;
      return;
    }
    ctx.el.innerHTML = authShell('Tạo tài khoản quản trị đầu tiên', 'Trang này chỉ dùng được một lần, khi cơ sở dữ liệu Firebase chưa có quản trị viên nào.',
      `<form class="form" novalidate data-form>
        <label class="field"><span>Họ và tên</span><input name="fullName" required></label>
        <label class="field"><span>Tên đăng nhập</span><input name="username" required autocapitalize="none" spellcheck="false"></label>
        ${pwField('password', 'Mật khẩu', 'new-password', 'Ít nhất 6 ký tự.')}
        <p class="form-err" data-err hidden role="alert"></p>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Tạo quản trị viên</button>
      </form>`,
      `<h2>Sau bước này</h2><p>Vào Trang quản trị, nhập file Excel danh sách học sinh, tạo thùng rác và in mã QR.</p>`);
    const form = U.$('[data-form]', ctx.el);
    bindPw(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); showErr(form, ''); setBusy(form, true);
      try { await GS.svc.setupFirstAdmin(U.formData(form)); U.toast('Đã tạo quản trị viên'); GS.go('/admin'); }
      catch (err) { showErr(form, GS.svc.errMsg(err)); }
      finally { setBusy(form, false); }
    });
  }, { title: 'Thiết lập' });

  /* ---------------- Về dự án ---------------- */
  GS.route('/about', (ctx) => {
    const s = GS.state.settings;
    ctx.el.innerHTML = `
      <section class="wrap about">
        <span class="chip chip-leaf">${U.icon('bolt')}Sản phẩm khoa học kĩ thuật</span>
        <h1>Thùng rác thông minh phân loại nhựa và kim loại</h1>
        <p class="lead">Camera máy tính chạy mô hình huấn luyện bằng Edge Impulse để nhận diện hai loại rác chính là nhựa và kim loại. Mạch ESP32 điều khiển cảm biến, servo đóng mở nắp thùng và đèn LED báo loại rác. ${U.esc(s.appName)} ghi nhận từng lượt bỏ rác đúng và cộng điểm thi đua cho lớp.</p>

        <h2>Dữ liệu đi từ thùng rác tới bảng xếp hạng</h2>
        <ol class="flow">
          <li><span class="flow-ic">${U.icon('qr')}</span><b>Học sinh quét QR</b><p>Web mở phiên bỏ rác gắn với tài khoản của bạn trên đúng thùng đó.</p></li>
          <li><span class="flow-ic">${U.icon('camera')}</span><b>Camera + Edge Impulse</b><p>Mô hình nhận diện vật thể là nhựa hay kim loại.</p></li>
          <li><span class="flow-ic">${U.icon('bolt')}</span><b>ESP32</b><p>Mở nắp bằng servo, bật LED theo loại rác, cảm biến xác nhận rác đã rơi vào thùng.</p></li>
          <li><span class="flow-ic">${U.icon('database')}</span><b>Firebase Realtime Database</b><p>ESP32 gửi lượt đếm qua USB; cầu nối máy tính chuyển sự kiện vào Firebase.</p></li>
          <li><span class="flow-ic">${U.icon('trophy')}</span><b>Cộng điểm tức thì</b><p>Hệ thống kiểm tra phiên, tính điểm và cập nhật bảng xếp hạng.</p></li>
        </ol>

        <div class="split section">
          <div class="panel"><h2>Quy tắc tính điểm hiện tại</h2>
            <ul class="rule-list">${GS.ui.ruleList().map((r) => `<li><span class="rule-ic" style="--c:${r.color}">${U.icon(GS.ui.typeIcon(r.key))}</span><span><b>${U.esc(r.label)}</b><small>${r.enabled === false ? 'Đang tạm dừng' : 'Mỗi lượt bỏ đúng'}</small></span><span class="rule-pts">+${r.points}<small>điểm</small></span></li>`).join('')}</ul>
          </div>
          <div class="panel"><h2>Chống gian lận</h2>
            <ul class="bullets">
              <li>Mỗi lượt có mã giao dịch riêng, một mã chỉ được cộng điểm một lần.</li>
              <li>Phiên trên thùng tự hết hạn sau ${s.sessionMinutes} phút không bỏ rác.</li>
              <li>Hai lượt của cùng một bạn phải cách nhau ít nhất ${s.cooldownSeconds} giây.</li>
              <li>Thầy cô có thể huỷ lượt sai và xem toàn bộ lịch sử.</li>
            </ul>
          </div>
        </div>
      </section>`;
  }, { title: 'Về dự án' });

  GS.route('/404', (ctx) => {
    ctx.el.innerHTML = `<div class="wrap empty-state"><h1>Không có trang này</h1><p class="muted">Đường dẫn có thể đã thay đổi. Quay lại bảng xếp hạng để tiếp tục.</p><a class="btn btn-primary" href="#/">Về bảng xếp hạng</a></div>`;
  }, { title: 'Không tìm thấy' });
})();
