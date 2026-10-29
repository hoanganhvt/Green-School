/* Quản trị: Thùng rác & mã QR — tạo thùng, in QR, trạng thái thiết bị, thông tin kết nối ESP32 */
(function () {
  const GS = window.GS;
  const U = GS.util;
  const A = GS.admin;

  const qrMatrix = async (text) => {
    const qrcode = await U.libs.qr();
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    return q;
  };
  A.qrSvg = async (text) => (await qrMatrix(text)).createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  A.qrPng = async (text, size = 900, caption = '') => {
    const q = await qrMatrix(text);
    const n = q.getModuleCount(), m = 4, cell = Math.floor(size / (n + m * 2));
    const cv = document.createElement('canvas');
    const capH = caption ? 90 : 0;
    cv.width = cell * (n + m * 2); cv.height = cv.width + capH;
    const c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#10301F';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) c.fillRect((k + m) * cell, (r + m) * cell, cell, cell);
    if (caption) { c.font = 'bold 44px "Be Vietnam Pro", sans-serif'; c.textAlign = 'center'; c.fillText(caption, cv.width / 2, cv.width + 40); }
    return new Promise((res) => cv.toBlob(res, 'image/png'));
  };

  const printBins = async (list) => {
    const s = GS.state.settings;
    const rules = GS.ui.ruleList().filter((r) => r.enabled !== false);
    const cards = await Promise.all(list.map(async (b) => `
      <div class="qr-card">
        <div class="qr-card-top">${GS.layout.logo()}<b>${U.esc(s.appName)}</b></div>
        <h2>Quét để tích điểm cho lớp bạn</h2>
        <div class="qr-card-code">${await A.qrSvg(GS.svc.binUrl(b.id))}</div>
        <p class="qr-card-bin"><b>${U.esc(b.name)}</b><span>${U.esc(b.id)}${b.location ? ', ' + U.esc(b.location) : ''}</span></p>
        <p class="qr-card-rules">${rules.map((r) => `${U.esc(r.label)} +${r.points} điểm`).join('&nbsp;&nbsp;|&nbsp;&nbsp;')}</p>
      </div>`));
    U.print(`<div class="qr-sheet">${cards.join('')}</div>`, 'Mã QR thùng rác');
  };

  const binForm = (b = {}) => `
    <label class="field"><span>Mã thùng</span><input name="id" required ${b.id ? 'readonly' : ''} value="${U.esc(b.id || '')}" placeholder="BIN-04" autocapitalize="characters"><small class="hint">Chữ không dấu, số, gạch ngang. Mã này nạp vào code ESP32 (BIN_ID) và không đổi được sau khi tạo.</small></label>
    <label class="field"><span>Tên thùng</span><input name="name" required value="${U.esc(b.name || '')}" placeholder="Thùng hành lang tầng 2"></label>
    <label class="field"><span>Vị trí đặt</span><input name="location" value="${U.esc(b.location || '')}" placeholder="Cạnh cầu thang dãy B"></label>`;

  const connectInfo = (b) => {
    const cfg = GS.svc.firebaseConfig();
    const url = GS.USE_EMULATORS ? 'http://127.0.0.1:9000' : cfg && cfg.databaseURL ? cfg.databaseURL.replace(/\/$/, '') : 'https://<ten-du-an>-default-rtdb.<vung>.firebasedatabase.app';
    const suffix = GS.USE_EMULATORS ? '?ns=demo-green-school-default-rtdb&auth=<ID_TOKEN>' : '?auth=<ID_TOKEN>';
    const ex = JSON.stringify({ txId: 'TX1729500000-BIN01-0007', binId: b.id, type: 'plastic', deviceUid: '<UID tài khoản thiết bị>', studentCode: '<lấy từ activeSession>', ts: { '.sv': 'timestamp' }, status: 'pending', source: 'esp32' }, null, 2);
    return `
      <p class="muted">Firmware chính là <code>hardware/Green-School/Green-School.ino</code>. Chạy <code>hardware/firebase_usb_bridge.ps1</code> để chuyển lượt đếm USB sang Firebase local. Các yêu cầu REST cần ID token của tài khoản thiết bị đã được cấp quyền trong <code>/devices</code>.</p>
      <dl class="kv">
        <dt>BIN_ID</dt><dd><code>${U.esc(b.id)}</code></dd>
        <dt>DATABASE_URL</dt><dd><code>${U.esc(url)}</code></dd>
      </dl>
      <h4>1. Đọc học sinh đang dùng thùng</h4>
      <pre class="code-block">GET ${U.esc(url)}/bins/${U.esc(b.id)}/activeSession.json${U.esc(suffix)}</pre>
      <h4>2. Gửi lượt bỏ rác (mỗi lượt một txId mới)</h4>
      <pre class="code-block">PUT ${U.esc(url)}/events/&lt;txId&gt;.json${U.esc(suffix)}\n${U.esc(ex)}</pre>
      <h4>3. Báo thùng còn hoạt động (mỗi 30 giây)</h4>
      <pre class="code-block">PATCH ${U.esc(url)}/bins/${U.esc(b.id)}.json${U.esc(suffix)}\n{ "lastSeen": { ".sv": "timestamp" }, "ip": "192.168.1.50" }</pre>
      <p class="hint">Giá trị <code>type</code> phải trùng khoá quy tắc điểm (trang Cài đặt), ví dụ nhãn mô hình Edge Impulse <code>plastic</code>, <code>metal</code>.</p>`;
  };

  A.route('/admin/bins', (ctx) => {
    ctx.el.innerHTML = A.head('Thùng rác & QR', 'Mỗi thùng có một mã QR riêng. In và dán lên nắp thùng để học sinh quét.',
      `<button class="btn btn-ghost" data-print-all>${U.icon('print')}In tất cả mã QR</button><button class="btn btn-primary" data-add>${U.icon('plus')}Thêm thùng</button>`) + `
      <div class="bin-grid" data-grid><p class="muted">Đang tải…</p></div>`;
    const $ = (s) => U.$(s, ctx.el);
    let bins = {}, qrCache = {};

    const paint = async () => {
      const list = Object.values(bins).sort((a, b) => String(a.id).localeCompare(String(b.id), 'vi', { numeric: true }));
      if (!list.length) { $('[data-grid]').innerHTML = `<div class="empty-state small"><h2>Chưa có thùng nào</h2><p class="muted">Thêm thùng đầu tiên để tạo mã QR.</p><button class="btn btn-primary" data-add>${U.icon('plus')}Thêm thùng</button></div>`; return; }
      $('[data-grid]').innerHTML = list.map((b) => {
        const on = GS.svc.binOnline(b);
        const s = b.activeSession && b.activeSession.expiresAt > GS.now() ? b.activeSession : null;
        return `<article class="bin-card">
          <div class="bin-qr" data-qr="${U.esc(b.id)}">${qrCache[b.id] || ''}</div>
          <div class="bin-info">
            <h3>${U.esc(b.name)}</h3>
            <p class="muted"><code>${U.esc(b.id)}</code>${b.location ? `, ${U.esc(b.location)}` : ''}</p>
            <p><span class="status ${on ? 'ok' : 'off'}">${on ? 'Đang kết nối' : 'Mất kết nối'}</span> <small class="muted">${b.lastSeen ? 'tín hiệu ' + U.timeAgo(b.lastSeen) : 'chưa từng gửi tín hiệu'}</small></p>
            <p class="bin-count"><b>${U.fmt(b.count)}</b> lượt bỏ rác${s ? `<span class="pill pill-leaf">${U.esc(U.shortName(s.fullName))} ${U.esc(s.className)} đang dùng</span>` : ''}</p>
            <div class="row-btns">
              <button class="btn btn-xs btn-ghost" data-png="${U.esc(b.id)}">${U.icon('download')}PNG</button>
              <button class="btn btn-xs btn-ghost" data-print="${U.esc(b.id)}">${U.icon('print')}In</button>
              <button class="btn btn-xs btn-ghost" data-conn="${U.esc(b.id)}">${U.icon('wifi')}Kết nối ESP32</button>
              <button class="btn btn-xs btn-ghost" data-test="${U.esc(b.id)}">${U.icon('send')}Gửi lượt thử</button>
              <button class="icon-btn" data-edit="${U.esc(b.id)}" aria-label="Sửa">${U.icon('edit')}</button>
              <button class="icon-btn danger" data-del="${U.esc(b.id)}" aria-label="Xoá">${U.icon('trash')}</button>
            </div>
            <a class="link small" href="${U.esc(GS.svc.binUrl(b.id))}" target="_blank" rel="noopener">${U.esc(GS.svc.binUrl(b.id))}</a>
          </div></article>`;
      }).join('');
      for (const b of list) {
        if (!qrCache[b.id]) {
          try { qrCache[b.id] = await A.qrSvg(GS.svc.binUrl(b.id)); } catch (e) { qrCache[b.id] = '<p class="muted small">Không tải được thư viện QR (cần Internet)</p>'; }
          const el = U.$(`[data-qr="${CSS.escape(b.id)}"]`, ctx.el); if (el) el.innerHTML = qrCache[b.id];
        }
      }
    };
    ctx.cleanup(GS.db.on('bins', (v) => { bins = v || {}; paint(); }));
    ctx.cleanup(GS.bus.on('settings', () => { qrCache = {}; paint(); }));
    const t = setInterval(paint, 15e3); ctx.cleanup(() => clearInterval(t));

    ctx.el.addEventListener('click', async (e) => {
      const g = (k) => { const el = e.target.closest(`[data-${k}]`); return el ? el.dataset[k] : null; };
      try {
        if (e.target.closest('[data-add]')) {
          const n = Object.keys(bins).length + 1;
          await U.modal({ title: 'Thêm thùng rác', body: binForm({}), actions: [{ label: 'Huỷ' }, { label: 'Tạo thùng và mã QR', kind: 'primary', submit: true }],
            onOpen: (ov) => { U.$('input[name=id]', ov).value = `BIN-${String(n).padStart(2, '0')}`; },
            onSubmit: async (f) => { const d = U.formData(f); const id = d.id.trim().toUpperCase(); if (bins[id]) throw new Error('Mã thùng đã tồn tại'); await GS.svc.saveBin(d); U.toast(`Đã tạo thùng ${id}`); } });
        }
        if (e.target.closest('[data-print-all]')) { const l = Object.values(bins); if (!l.length) return U.toast('Chưa có thùng nào', 'warn'); await printBins(l); }
        const png = g('png'); if (png) U.download(`qr-${png}.png`, await A.qrPng(GS.svc.binUrl(png), 900, `${bins[png].name} (${png})`));
        const pr = g('print'); if (pr) await printBins([bins[pr]]);
        const conn = g('conn'); if (conn) U.modal({ title: `Kết nối ESP32 cho ${conn}`, wide: true, body: connectInfo(bins[conn]) });
        const test = g('test'); if (test) {
          await U.modal({ title: `Gửi lượt thử vào ${test}`,
            body: `<label class="field"><span>Loại rác</span><select name="type">${GS.ui.ruleList().map((r) => `<option value="${U.esc(r.key)}">${U.esc(r.label)}</option>`).join('')}</select></label>
                   <label class="field"><span>Mã học sinh</span><input name="studentCode" placeholder="Bỏ trống để dùng phiên đang mở" autocapitalize="characters"></label>`,
            actions: [{ label: 'Huỷ' }, { label: 'Gửi sự kiện', kind: 'primary', submit: true }],
            onSubmit: async (f) => { const id = await GS.svc.simulateEvent({ binId: test, type: f.type.value, studentCode: f.studentCode.value.trim().toUpperCase() || null }); U.toast(`Đã gửi ${id}. Xem kết quả ở trang Tổng quan`); } });
        }
        const ed = g('edit'); if (ed) await U.modal({ title: `Sửa ${ed}`, body: binForm(bins[ed]), actions: [{ label: 'Huỷ' }, { label: 'Lưu thay đổi', kind: 'primary', submit: true }], onSubmit: async (f) => { await GS.svc.saveBin(U.formData(f)); U.toast('Đã lưu thay đổi'); } });
        const del = g('del'); if (del && await U.confirm('Xoá thùng?', `Mã QR của ${U.esc(del)} sẽ không dùng được nữa. Lịch sử điểm vẫn giữ.`, { okLabel: 'Xoá thùng', danger: true })) { await GS.svc.deleteBin(del); U.toast('Đã xoá thùng'); }
      } catch (err) { U.toast(GS.svc.errMsg(err), 'err'); }
    });
  }, 'Thùng rác & QR');
})();
