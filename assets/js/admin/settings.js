/* Quản trị: Cài đặt — tên app, quy tắc điểm từng loại rác, phiên & chống gian lận, Firebase, dữ liệu */
(function () {
  const GS = window.GS;
  const U = GS.util;
  const A = GS.admin;

  /* Chấp nhận cả JSON lẫn đoạn "const firebaseConfig = {...}" dán từ Firebase Console */
  const parseConfig = (txt) => {
    const m = String(txt).match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Không thấy cấu hình dạng { ... }');
    let s = m[0].replace(/\/\/.*$/gm, '').replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,\s*}/g, '}');
    const cfg = JSON.parse(s);
    if (!cfg.apiKey || !cfg.databaseURL) throw new Error('Cấu hình cần có apiKey và databaseURL (bật Realtime Database trước khi lấy cấu hình)');
    return cfg;
  };

  A.route('/admin/settings', (ctx) => {
    const s = GS.state.settings;
    const src = GS.svc.configSource();
    const isFb = GS.db.mode === 'firebase';
    ctx.el.innerHTML = A.head('Cài đặt', 'Thay đổi được áp dụng ngay cho mọi người đang mở web/app.') + `
      <div class="settings">
        <form class="card" data-general>
          <div class="card-head"><h2>Thông tin chung</h2></div>
          <div class="grid-2">
            <label class="field"><span>Tên web/app</span><input name="appName" required maxlength="40" value="${U.esc(s.appName)}"><small class="hint">Hiện ở đầu trang, tab trình duyệt, phiếu mã và mã QR in ra.</small></label>
            <label class="field"><span>Tên trường</span><input name="schoolName" maxlength="80" value="${U.esc(s.schoolName)}"></label>
          </div>
          <label class="field"><span>Khẩu hiệu</span><input name="slogan" maxlength="90" value="${U.esc(s.slogan)}"></label>
          <label class="field"><span>Tên mùa thi đua</span><input name="seasonName" maxlength="60" value="${U.esc(s.seasonName)}"></label>
          <div class="row-btns end"><button class="btn btn-primary" type="submit">Lưu thông tin</button></div>
        </form>

        <form class="card" data-rules>
          <div class="card-head"><h2>Quy tắc tính điểm</h2></div>
          <p class="muted small">Mỗi loại rác ứng với một nhãn mà mô hình Edge Impulse trả về và ESP32 gửi lên ở trường <code>type</code>. Điểm thay đổi chỉ áp dụng cho các lượt sau đó.</p>
          <div class="table-wrap"><table class="tbl rules-tbl"><thead><tr><th>Nhãn mô hình</th><th>Tên hiển thị</th><th>Điểm mỗi lượt</th><th>Màu</th><th>Đang tính</th><th></th></tr></thead><tbody data-rule-rows></tbody></table></div>
          <div class="row-btns between"><button type="button" class="btn btn-ghost btn-sm" data-add-rule>${U.icon('plus')}Thêm loại rác</button><button class="btn btn-primary" type="submit">Lưu quy tắc</button></div>
        </form>

        <form class="card" data-session>
          <div class="card-head"><h2>Phiên bỏ rác và chống gian lận</h2></div>
          <div class="grid-2">
            <label class="field"><span>Giữ phiên sau khi quét QR (phút)</span><input name="sessionMinutes" type="number" min="1" max="30" value="${s.sessionMinutes}"><small class="hint">Sau thời gian này không bỏ rác, thùng tự trống cho bạn khác.</small></label>
            <label class="field"><span>Khoảng cách tối thiểu giữa 2 lượt (giây)</span><input name="cooldownSeconds" type="number" min="0" max="120" value="${s.cooldownSeconds}"><small class="hint">Lượt đến nhanh hơn sẽ bị từ chối.</small></label>
          </div>
          <div class="grid-2">
            <label class="field"><span>Tiền tố mã học sinh</span><input name="codePrefix" maxlength="4" value="${U.esc(s.codePrefix || '')}" placeholder="Để trống hoặc GS" autocapitalize="characters"><small class="hint">Ví dụ GS → GS10A1-K7Q2. Chỉ áp dụng cho mã tạo mới.</small></label>
            <label class="field"><span>Địa chỉ web dùng cho mã QR</span><input name="baseUrl" value="${U.esc(s.baseUrl || '')}" placeholder="${U.esc(location.origin + location.pathname)}"><small class="hint">Để trống thì dùng địa chỉ đang mở. Điền địa chỉ thật khi đã đưa web lên mạng.</small></label>
          </div>
          <div class="row-btns end"><button class="btn btn-primary" type="submit">Lưu cài đặt</button></div>
        </form>

        <section class="card">
          <div class="card-head"><h2>Kết nối Firebase Realtime Database</h2><span class="mode-pill ${isFb ? 'is-fb' : ''}">${U.icon(isFb ? 'database' : 'info')}<span>${isFb ? 'Đang dùng Firebase' : 'Đang chạy demo'}</span><i class="dot"></i></span></div>
          ${isFb ? `<p class="muted small">Đã kết nối tới <code>${U.esc((GS.svc.firebaseConfig() || {}).databaseURL || '')}</code>${src === 'file' ? ' (cấu hình trong file assets/js/config.js)' : ''}.</p>`
            : `<p class="muted small">Dữ liệu demo chỉ lưu trên trình duyệt này. Dán cấu hình Web App từ Firebase Console để mọi thiết bị và ESP32 dùng chung dữ liệu thật.</p>`}
          <label class="field"><span>Cấu hình Firebase</span><textarea rows="7" data-cfg spellcheck="false" placeholder='const firebaseConfig = {\n  apiKey: "…",\n  authDomain: "…",\n  databaseURL: "https://…firebasedatabase.app",\n  projectId: "…",\n  appId: "…"\n};'>${src === 'admin' ? U.esc(JSON.stringify(GS.svc.firebaseConfig(), null, 2)) : ''}</textarea></label>
          <div class="row-btns">
            <button class="btn btn-primary" data-connect>${U.icon('database')}Kết nối và tải lại</button>
            ${isFb || src === 'admin' ? `<button class="btn btn-ghost" data-demo>Quay về chế độ demo</button>` : ''}
            ${src === 'forced-demo' ? `<button class="btn btn-ghost" data-undemo>Dùng lại cấu hình trong config.js</button>` : ''}
          </div>
          <p class="hint">Sau khi kết nối lần đầu, mở <code>#/setup</code> để tạo tài khoản quản trị trên Firebase. Xem README.md để biết cách bật Authentication và dán Rules.</p>
        </section>

        <section class="card">
          <div class="card-head"><h2>Dữ liệu</h2></div>
          <div class="row-btns">
            <button class="btn btn-ghost" data-backup>${U.icon('download')}Sao lưu toàn bộ (JSON)</button>
            ${GS.db.mode === 'demo' ? `<button class="btn btn-ghost danger-text" data-reseed>${U.icon('refresh')}Tạo lại dữ liệu demo</button><button class="btn btn-ghost danger-text" data-wipe>${U.icon('trash')}Xoá sạch dữ liệu demo</button>` : ''}
          </div>
        </section>
      </div>`;
    const $ = (q) => U.$(q, ctx.el);

    /* --- Quy tắc --- */
    let rules = JSON.parse(JSON.stringify(s.rules || {}));
    const ruleRow = (key, r) => `<tr data-key="${U.esc(key)}">
      <td><input class="in-sm mono" name="key" value="${U.esc(key)}" aria-label="Nhãn mô hình" required></td>
      <td><input class="in-sm" name="label" value="${U.esc(r.label)}" aria-label="Tên hiển thị" required></td>
      <td><input class="in-sm num" name="points" type="number" step="1" value="${Number(r.points) || 0}" aria-label="Điểm mỗi lượt"></td>
      <td><input type="color" name="color" value="${U.esc(r.color || '#1FA35B')}" aria-label="Màu"></td>
      <td><label class="switch"><input type="checkbox" name="enabled" ${r.enabled !== false ? 'checked' : ''}><span aria-hidden="true"></span><b class="sr-only">Đang tính điểm</b></label></td>
      <td><button type="button" class="icon-btn danger" data-del-rule aria-label="Xoá loại rác">${U.icon('trash')}</button></td></tr>`;
    const paintRules = () => {
      $('[data-rule-rows]').innerHTML = Object.entries(rules).sort((a, b) => (a[1].order || 99) - (b[1].order || 99)).map(([k, r]) => ruleRow(k, r)).join('');
    };
    paintRules();
    $('[data-add-rule]').onclick = () => {
      const tb = $('[data-rule-rows]');
      tb.insertAdjacentHTML('beforeend', ruleRow('', { label: '', points: 1, color: '#8A6BD1', enabled: true }));
      U.$('tr:last-child input[name=key]', tb).focus();
    };
    $('[data-rule-rows]').addEventListener('click', (e) => { const d = e.target.closest('[data-del-rule]'); if (d) d.closest('tr').remove(); });
    $('[data-rules]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const out = {}; let order = 1;
      for (const tr of U.$$('[data-rule-rows] tr', ctx.el)) {
        const key = U.$('[name=key]', tr).value.trim().toLowerCase();
        const label = U.$('[name=label]', tr).value.trim();
        if (!key && !label) continue;
        if (!/^[a-z0-9_-]+$/.test(key)) return U.toast(`Nhãn "${key}" chỉ gồm chữ thường không dấu, số, gạch dưới`, 'err');
        if (out[key]) return U.toast(`Nhãn "${key}" bị trùng`, 'err');
        if (!label) return U.toast(`Nhập tên hiển thị cho nhãn ${key}`, 'err');
        out[key] = { label, points: Math.round(Number(U.$('[name=points]', tr).value) || 0), color: U.$('[name=color]', tr).value, enabled: U.$('[name=enabled]', tr).checked, order: order++ };
      }
      if (!Object.keys(out).length) return U.toast('Cần ít nhất một loại rác', 'err');
      try { await GS.svc.saveSettings({ rules: out }); rules = out; U.toast('Đã lưu quy tắc tính điểm'); } catch (err) { U.toast(GS.svc.errMsg(err), 'err'); }
    });

    /* --- Thông tin chung & phiên --- */
    $('[data-general]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = U.formData(e.target);
      if (!d.appName.trim()) return U.toast('Tên web/app không được để trống', 'err');
      try { await GS.svc.saveSettings({ appName: d.appName.trim(), schoolName: d.schoolName.trim(), slogan: d.slogan.trim(), seasonName: d.seasonName.trim() }); U.toast('Đã lưu thông tin chung'); } catch (err) { U.toast(GS.svc.errMsg(err), 'err'); }
    });
    $('[data-session]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = U.formData(e.target);
      try {
        await GS.svc.saveSettings({ sessionMinutes: Math.min(30, Math.max(1, Number(d.sessionMinutes) || 3)), cooldownSeconds: Math.min(120, Math.max(0, Number(d.cooldownSeconds) || 0)), codePrefix: d.codePrefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''), baseUrl: d.baseUrl.trim() });
        U.toast('Đã lưu cài đặt');
      } catch (err) { U.toast(GS.svc.errMsg(err), 'err'); }
    });

    /* --- Firebase --- */
    $('[data-connect]').onclick = () => {
      let cfg;
      try { cfg = parseConfig($('[data-cfg]').value); } catch (e) { return U.toast(e.message, 'err', 5000); }
      try { localStorage.setItem('gs_firebase_config', JSON.stringify(cfg)); localStorage.removeItem('gs_force_demo'); } catch (e) { return U.toast('Trình duyệt chặn lưu cấu hình', 'err'); }
      U.toast('Đang kết nối Firebase…');
      setTimeout(() => { location.hash = '#/setup'; location.reload(); }, 600);
    };
    const demoBtn = $('[data-demo]');
    if (demoBtn) demoBtn.onclick = async () => {
      if (!(await U.confirm('Quay về chế độ demo?', 'Trình duyệt này sẽ ngừng dùng Firebase. Dữ liệu trên Firebase không bị ảnh hưởng.', { okLabel: 'Về chế độ demo' }))) return;
      try { localStorage.removeItem('gs_firebase_config'); if (GS.FIREBASE_CONFIG) localStorage.setItem('gs_force_demo', '1'); } catch (e) { /* bỏ qua */ }
      location.hash = '#/'; location.reload();
    };
    const undemo = $('[data-undemo]');
    if (undemo) undemo.onclick = () => { try { localStorage.removeItem('gs_force_demo'); } catch (e) { /* bỏ qua */ } location.reload(); };

    /* --- Dữ liệu --- */
    $('[data-backup]').onclick = async () => {
      const keys = ['settings', 'classes', 'weekly', 'students', 'users', 'bins', 'transactions'];
      const out = {};
      for (const k of keys) out[k] = await GS.db.get(k);
      U.download(`sao-luu-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out, null, 2));
    };
    const reseed = $('[data-reseed]');
    if (reseed) reseed.onclick = async () => {
      if (!(await U.confirm('Tạo lại dữ liệu demo?', 'Mọi thay đổi trên trình duyệt này sẽ mất và thay bằng dữ liệu mẫu.', { okLabel: 'Tạo lại', danger: true }))) return;
      await GS.seed(GS.db); await GS.db.signOut(); location.hash = '#/login'; location.reload();
    };
    const wipe = $('[data-wipe]');
    if (wipe) wipe.onclick = async () => {
      if (!(await U.confirm('Xoá sạch dữ liệu demo?', 'Chỉ giữ lại tài khoản admin / admin123 để bạn thử nhập danh sách học sinh thật từ đầu.', { okLabel: 'Xoá sạch', danger: true, typeText: 'XOA' }))) return;
      const keepAuth = GS.db.read('_auth/admin'), keepUser = GS.db.read('users/uadmin');
      GS.db.tree = { settings: GS.db.read('settings'), meta: { seeded: true, hasAdmin: true }, _auth: { admin: keepAuth }, users: { uadmin: keepUser }, usernames: { admin: { uid: 'uadmin', studentCode: null } }, admins: { uadmin: true } };
      GS.db.save(); location.reload();
    };
  }, 'Cài đặt');
})();
