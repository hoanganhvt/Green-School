/* Quét mã QR thùng rác + phiên bỏ rác tích điểm thời gian thực */
(function () {
  const GS = window.GS;
  const U = GS.util;

  const binFromText = (txt) => {
    const s = String(txt || '').trim();
    const m = s.match(/#\/scan\/([^/?#\s]+)/);
    if (m) return decodeURIComponent(m[1]);
    if (/^[A-Za-z0-9_-]{2,30}$/.test(s)) return s.toUpperCase();
    return null;
  };

  /* ---------------- Màn quét bằng camera ---------------- */
  GS.route('/scan', (ctx) => {
    ctx.el.innerHTML = `
      <section class="wrap scan-pick">
        <h1>Quét mã trên thùng rác</h1>
        <p class="muted">Hướng camera vào mã QR dán trên nắp thùng. Bạn cũng có thể dùng ứng dụng camera của điện thoại.</p>
        <div class="scanner" data-scanner>
          <video playsinline muted data-video></video>
          <span class="scan-frame" aria-hidden="true"></span>
          <div class="scanner-off" data-off>
            ${U.icon('camera', 'ic-xl')}
            <button class="btn btn-primary" data-start>Bật camera để quét</button>
            <small class="muted" data-cam-msg></small>
          </div>
        </div>
        <form class="inline-form" data-manual>
          <label class="field grow"><span>Hoặc nhập mã thùng</span><input name="bin" placeholder="Ví dụ: BIN-01" autocapitalize="characters" required></label>
          <button class="btn btn-ghost" type="submit">Mở thùng</button>
        </form>
      </section>`;
    const video = U.$('[data-video]', ctx.el);
    let stream = null, raf = 0, stopped = false;
    const stop = () => { stopped = true; cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
    ctx.cleanup(stop);

    const found = (txt) => {
      const bin = binFromText(txt);
      if (!bin) return false;
      stop();
      if (navigator.vibrate) navigator.vibrate(60);
      GS.go(`/scan/${encodeURIComponent(bin)}`);
      return true;
    };

    U.$('[data-start]', ctx.el).onclick = async () => {
      const msg = U.$('[data-cam-msg]', ctx.el);
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg.textContent = 'Trình duyệt không hỗ trợ camera ở trang này (cần mở bằng https). Hãy nhập mã thùng bên dưới.'; return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch (e) { msg.textContent = 'Không mở được camera. Hãy cho phép quyền camera hoặc nhập mã thùng.'; return; }
      video.srcObject = stream; await video.play();
      U.$('[data-off]', ctx.el).hidden = true;
      U.$('[data-scanner]', ctx.el).classList.add('on');
      let detector = null;
      if ('BarcodeDetector' in window) { try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; } }
      const jsQR = detector ? null : await U.libs.jsqr().catch(() => null);
      const canvas = document.createElement('canvas');
      const c2d = canvas.getContext('2d', { willReadFrequently: true });
      let busy = false;
      const tick = async () => {
        if (stopped) return;
        if (!busy && video.readyState >= 2) {
          busy = true;
          try {
            if (detector) {
              const codes = await detector.detect(video);
              if (codes[0] && found(codes[0].rawValue)) return;
            } else if (jsQR) {
              const w = 480, h = Math.round((video.videoHeight / video.videoWidth) * w) || 360;
              canvas.width = w; canvas.height = h; c2d.drawImage(video, 0, 0, w, h);
              const r = jsQR(c2d.getImageData(0, 0, w, h).data, w, h);
              if (r && found(r.data)) return;
            }
          } catch (e) { /* bỏ qua khung hình lỗi */ }
          busy = false;
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
    };

    U.$('[data-manual]', ctx.el).addEventListener('submit', (e) => {
      e.preventDefault();
      if (!found(e.target.bin.value)) U.toast('Mã thùng chỉ gồm chữ, số và gạch ngang', 'err');
    });
  }, { title: 'Quét mã' });

  /* ---------------- Phiên bỏ rác ---------------- */
  GS.route('/scan/:bin', async (ctx) => {
    const binId = String(ctx.params.bin).toUpperCase();
    const me = GS.state.user;
    if (!me.studentCode) {
      ctx.el.innerHTML = `<div class="wrap empty-state"><h1>Tài khoản quản trị không tích điểm</h1><p class="muted">Đăng nhập bằng tài khoản học sinh để bỏ rác ở thùng ${U.esc(binId)}. Muốn chạy thử, dùng nút Gửi lượt thử trong trang Thùng rác & QR.</p><a class="btn btn-primary" href="#/admin/bins">Mở trang Thùng rác & QR</a></div>`;
      return;
    }
    ctx.el.innerHTML = `<section class="wrap scan-live" data-root><div class="loading">Đang mở thùng ${U.esc(binId)}…</div></section>`;
    const root = U.$('[data-root]', ctx.el);
    ctx.cleanup(GS.svc.startProcessor());

    let bin = null, state = 'loading', session = null, startedAt = GS.now(), txs = [], evs = [], seenTx = new Set(), firstTx = true;
    const mine = () => session && session.studentCode === me.studentCode;

    const start = async () => {
      try {
        const r = await GS.svc.startSession(binId);
        if (r.committed) { session = r.value; startedAt = Math.min(startedAt, session.startedAt); state = 'active'; }
        else state = 'busy';
      } catch (e) { U.toast(GS.svc.errMsg(e), 'err'); state = 'error'; }
      paint();
    };

    const paint = () => {
      if (!ctx.alive()) return;
      if (state === 'notfound') {
        root.innerHTML = `<div class="empty-state"><h1>Không tìm thấy thùng ${U.esc(binId)}</h1><p class="muted">Mã QR có thể đã cũ. Báo thầy cô quản trị để in lại mã.</p><a class="btn btn-primary" href="#/scan">Quét mã khác</a></div>`;
        return;
      }
      const now = GS.now();
      const online = GS.svc.binOnline(bin);
      const left = session ? session.expiresAt - now : 0;
      const myTx = txs.filter((t) => t.binId === binId && t.ts >= startedAt - 1000 && !t.revoked).reverse();
      const myRej = evs.filter((e) => e.status === 'rejected' && e.ts >= startedAt - 1000 && (!e.studentCode || e.studentCode === me.studentCode)).reverse();
      const sessionPts = myTx.reduce((a, t) => a + (Number(t.points) || 0), 0);

      const head = `<div class="bin-head">
          <span class="bin-badge">${U.icon('bin')}</span>
          <div><h1>${U.esc(bin.name || binId)}</h1><p class="muted">${U.esc(bin.location || '')} <span class="status ${online ? 'ok' : 'off'}">${online ? 'Thùng đang kết nối' : 'Thùng chưa kết nối'}</span></p></div>
        </div>`;

      if (state === 'busy') {
        const s = bin.activeSession;
        const wait = s ? s.expiresAt - now : 0;
        root.innerHTML = `${head}<div class="session session-busy"><h2>Thùng đang có bạn khác dùng</h2>
          <p>${U.esc(U.shortName(s && s.fullName))} lớp ${U.esc(s && s.className)} đang bỏ rác. Thùng sẽ trống sau tối đa <b>${U.mmss(wait)}</b>.</p>
          <button class="btn btn-primary" data-retry>${U.icon('refresh')}Thử lại</button></div>`;
        U.$('[data-retry]', root).onclick = start;
        return;
      }
      if (state === 'ended' || state === 'error') {
        root.innerHTML = `${head}<div class="session session-ended"><h2>Phiên đã kết thúc</h2>
          <p>Bạn góp <b>${U.fmt(sessionPts)} điểm</b> cho lớp ${U.esc(me.className)} trong phiên vừa rồi.</p>
          <div class="row-btns"><button class="btn btn-primary" data-restart>Bỏ rác tiếp</button><a class="btn btn-ghost" href="#/">Xem bảng xếp hạng</a></div></div>
          ${listHTML(myTx, myRej)}`;
        U.$('[data-restart]', root).onclick = () => { state = 'loading'; start(); };
        return;
      }
      if (state !== 'active') return;
      const pct = Math.max(0, Math.min(100, (left / GS.svc.sessionMs()) * 100));
      root.innerHTML = `${head}
        <div class="session session-active">
          <div class="ready" style="--pct:${pct}">
            <span class="ready-ring" aria-hidden="true"></span>
            <span class="ready-core">${U.icon('bin', 'ic-xl')}<b>Sẵn sàng</b><small>Bỏ rác vào thùng</small></span>
          </div>
          <div class="session-info">
            <p class="session-who">Đang tích điểm cho <b>lớp ${U.esc(me.className)}</b></p>
            <p class="session-time">Phiên còn <b data-left>${U.mmss(left)}</b>. Mỗi lần bỏ rác, phiên được gia hạn thêm.</p>
            <div class="session-sum"><span><b>${myTx.length}</b> lượt</span><span><b>${U.fmt(sessionPts)}</b> điểm trong phiên</span></div>
            <div class="row-btns">
              <button class="btn btn-ghost" data-extend>${U.icon('clock')}Thêm thời gian</button>
              <button class="btn btn-ghost" data-end>Kết thúc</button>
            </div>
          </div>
        </div>
        ${GS.db.mode === 'demo' ? `<div class="sim-box"><p><b>Chế độ demo:</b> chưa có ESP32 thật, bấm để giả lập thùng gửi dữ liệu.</p><div class="row-btns">${GS.ui.ruleList().map((r) => `<button class="btn btn-sm btn-ghost" data-sim="${r.key}"><i class="sw" style="background:${r.color}"></i>Bỏ ${U.esc(r.label.toLowerCase())}</button>`).join('')}</div></div>` : ''}
        ${listHTML(myTx, myRej)}`;
      U.$('[data-extend]', root).onclick = async () => { await GS.svc.extendSession(binId); U.toast('Đã gia hạn phiên'); };
      U.$('[data-end]', root).onclick = async () => { await GS.svc.endSession(binId); state = 'ended'; paint(); };
      U.$$('[data-sim]', root).forEach((b) => { b.onclick = () => GS.svc.simulateEvent({ binId, type: b.dataset.sim }); });
    };

    const listHTML = (myTx, myRej) => {
      const items = [...myTx.map((t) => ({ ok: true, ...t })), ...myRej.map((e) => ({ ok: false, ...e }))].sort((a, b) => b.ts - a.ts);
      if (!items.length) return `<p class="muted center small">Các lượt trong phiên này sẽ hiện ở đây.</p>`;
      return `<ul class="drops">${items.map((x) => x.ok
        ? `<li><span class="feed-ic" style="--c:${GS.ui.ruleColor(x.type)}">${U.icon(GS.ui.typeIcon(x.type))}</span><span>${U.esc(x.typeLabel || GS.ui.ruleLabel(x.type))}<small>${U.timeAgo(x.ts)}</small></span><b class="plus">+${x.points}</b></li>`
        : `<li class="rej"><span class="feed-ic" style="--c:var(--danger)">${U.icon('x')}</span><span>Lượt không được tính<small>${U.esc(x.reason || '')}</small></span><b>0</b></li>`).join('')}</ul>`;
    };

    const celebrate = (t) => {
      const pop = document.createElement('div');
      pop.className = 'celebrate';
      pop.innerHTML = `<span style="--c:${GS.ui.ruleColor(t.type)}">${U.icon(GS.ui.typeIcon(t.type))}</span><b>+${t.points} điểm</b><small>cho lớp ${U.esc(t.className)}</small>`;
      document.body.appendChild(pop);
      if (navigator.vibrate) navigator.vibrate([40, 40, 80]);
      setTimeout(() => pop.remove(), 1900);
    };

    /* Dữ liệu thời gian thực */
    let firstBin = true;
    ctx.cleanup(GS.db.on(`bins/${binId}`, (b) => {
      bin = b;
      if (!b) { state = 'notfound'; paint(); return; }
      const s = b.activeSession;
      if (s && s.studentCode === me.studentCode) session = s;
      else if (state === 'active') { state = 'ended'; session = null; }
      if (state === 'busy' && (!s || s.expiresAt < GS.now())) { start(); return; }
      if (firstBin) { firstBin = false; start(); return; }
      paint();
    }));
    ctx.cleanup(GS.db.onQuery('transactions', { orderBy: 'studentCode', equalTo: me.studentCode, limitToLast: 30 }, (list) => {
      txs = list.sort((a, b) => a.ts - b.ts);
      list.forEach((t) => {
        if (!seenTx.has(t.id)) { seenTx.add(t.id); if (!firstTx && t.binId === binId && t.ts >= startedAt - 1000) celebrate(t); }
      });
      firstTx = false;
      paint();
    }));
    ctx.cleanup(GS.db.onQuery('events', { orderBy: 'binId', equalTo: binId, limitToLast: 15 }, (list) => { evs = list; paint(); }));

    const tick = setInterval(() => {
      if (state === 'active' && session) {
        const left = session.expiresAt - GS.now();
        if (left <= 0) { state = 'ended'; paint(); return; }
        const el = U.$('[data-left]', root); if (el) el.textContent = U.mmss(left);
        const ring = U.$('.ready', root); if (ring) ring.style.setProperty('--pct', Math.max(0, (left / GS.svc.sessionMs()) * 100));
      } else if (state === 'busy') {
        const s = bin && bin.activeSession;
        if (!s || s.expiresAt < GS.now()) start(); else paint();
      }
    }, 1000);
    ctx.cleanup(() => clearInterval(tick));
  }, { auth: 'user', title: 'Tích điểm' });
})();
