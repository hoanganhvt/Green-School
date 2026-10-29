/* Trang quản trị: phần dùng chung + Tổng quan (thống kê, biểu đồ, giám sát thời gian thực, chạy thử) */
(function () {
  const GS = window.GS;
  const U = GS.util;
  const A = GS.admin = {};

  A.head = (title, sub = '', actions = '') => `
    <header class="a-head">
      <div><h1>${title}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div>
      ${actions ? `<div class="a-actions">${actions}</div>` : ''}
    </header>`;

  A.classOptions = (classes, selected = '', allLabel = '') => {
    const list = Object.values(classes || {}).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi', { numeric: true }));
    return (allLabel ? `<option value="">${allLabel}</option>` : '') + list.map((c) => `<option value="${U.esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${U.esc(c.name)}</option>`).join('');
  };

  A.statusChip = (ev) => {
    if (ev.status === 'processed') return `<span class="pill pill-ok">${U.icon('check')}Đã cộng +${ev.points || 0}</span>`;
    if (ev.status === 'rejected') return `<span class="pill pill-bad" title="${U.esc(ev.reason || '')}">${U.icon('x')}Từ chối</span>`;
    if (ev.status === 'processing') return `<span class="pill pill-warn">Đang xử lý</span>`;
    return `<span class="pill pill-warn">${U.icon('clock')}Chờ xử lý</span>`;
  };

  A.typeChip = (key) => `<span class="type-chip"><i style="background:${GS.ui.ruleColor(key)}"></i>${U.esc(GS.ui.ruleLabel(key))}</span>`;

  /* Mọi trang quản trị đều chạy bộ xử lý điểm để sự kiện từ ESP32 luôn được cộng */
  A.route = (path, handler, title) => GS.route(path, (ctx) => {
    ctx.cleanup(GS.svc.startProcessor());
    return handler(ctx);
  }, { auth: 'admin', layout: 'admin', title });

  /* ---------------- Biểu đồ cột chồng theo tuần ---------------- */
  const weekChart = (weekly, weeks) => {
    const rules = GS.ui.ruleList();
    const data = weeks.map((w) => {
      const byType = {};
      Object.values(weekly[w] || {}).forEach((c) => { Object.entries(c.byType || {}).forEach(([k, n]) => { byType[k] = (byType[k] || 0) + n; }); });
      const total = rules.reduce((a, r) => a + (byType[r.key] || 0), 0);
      return { w, byType, total };
    });
    const max = Math.max(4, ...data.map((d) => d.total));
    const nice = Math.ceil(max / 4) * 4;
    const ticks = [0, nice / 4, nice / 2, (nice * 3) / 4, nice];
    return `
      <div class="chart" role="img" aria-label="Số lượt bỏ rác ${weeks.length} tuần gần nhất">
        <div class="chart-grid">${ticks.slice().reverse().map((t) => `<span><em>${U.fmt(t)}</em></span>`).join('')}</div>
        <div class="chart-bars">${data.map((d) => `
          <div class="chart-col" tabindex="0" data-tip="${U.esc(`Tuần ${U.weekNo(d.w)} (${U.weekLabel(d.w)}): ${rules.map((r) => `${r.label} ${d.byType[r.key] || 0}`).join(', ')}, tổng ${d.total} lượt`)}">
            <span class="chart-total">${d.total ? U.fmt(d.total) : ''}</span>
            <span class="chart-stack" style="height:${(d.total / nice) * 100}%">${rules.map((r) => d.byType[r.key] ? `<i style="flex:${d.byType[r.key]};background:${r.color}"></i>` : '').join('')}</span>
            <small>T${U.weekNo(d.w)}</small>
          </div>`).join('')}</div>
        <div class="chart-tip" hidden></div>
      </div>
      <div class="legend">${rules.map((r) => `<span><i style="background:${r.color}"></i>${U.esc(r.label)}</span>`).join('')}</div>`;
  };
  A.bindChartTips = (root) => {
    const tip = U.$('.chart-tip', root);
    if (!tip) return;
    U.$$('.chart-col', root).forEach((c) => {
      const show = () => { tip.textContent = c.dataset.tip; tip.hidden = false; const r = c.getBoundingClientRect(); const pr = c.parentElement.getBoundingClientRect(); tip.style.left = Math.min(Math.max(0, r.left - pr.left + r.width / 2 - 110), pr.width - 220) + 'px'; };
      c.addEventListener('mouseenter', show); c.addEventListener('focus', show);
      c.addEventListener('mouseleave', () => { tip.hidden = true; }); c.addEventListener('blur', () => { tip.hidden = true; });
    });
  };

  /* ---------------- Tổng quan ---------------- */
  A.route('/admin', (ctx) => {
    const wk = U.weekKey(GS.now());
    const prev = U.prevWeek(wk);
    ctx.el.innerHTML = A.head('Tổng quan', `Tuần ${U.weekNo(wk)}, từ ${U.weekLabel(wk).replace(' – ', ' đến ')}`,
      `<a class="btn btn-ghost" href="#/admin/students">${U.icon('upload')}Nhập học sinh</a><a class="btn btn-primary" href="#/admin/bins">${U.icon('qr')}Mã QR thùng rác</a>`) + `
      <div class="stats" data-stats></div>
      <div class="a-grid">
        <section class="card span-2"><div class="card-head"><h2>Lượt bỏ rác 8 tuần gần nhất</h2></div><div data-chart></div></section>
        <section class="card"><div class="card-head"><h2>Xếp hạng tuần này</h2><a href="#/admin/points" class="link">Chi tiết</a></div><ol class="mini-rank" data-rank></ol></section>
        <section class="card span-2"><div class="card-head"><h2>Dữ liệu từ thùng rác</h2><span class="live-dot">Thời gian thực</span></div>
          <div class="table-wrap"><table class="tbl"><thead><tr><th>Thời gian</th><th>Mã giao dịch</th><th>Thùng</th><th>Loại rác</th><th>Học sinh</th><th>Kết quả</th></tr></thead><tbody data-events></tbody></table></div></section>
        <section class="card"><div class="card-head"><h2>Gửi lượt thử</h2></div>
          <p class="muted small">Tạo sự kiện giống hệt ESP32 gửi lên để kiểm tra quy trình cộng điểm khi chưa có phần cứng.</p>
          <form class="form" data-sim>
            <label class="field"><span>Thùng</span><select name="binId" data-bins required></select></label>
            <label class="field"><span>Loại rác (nhãn mô hình)</span><select name="type" data-types></select></label>
            <label class="field"><span>Mã học sinh</span><input name="studentCode" placeholder="Bỏ trống để dùng phiên đang mở" autocapitalize="characters" list="dl-codes"><datalist id="dl-codes" data-codes></datalist></label>
            <button class="btn btn-primary btn-block" type="submit">${U.icon('send')}Gửi sự kiện</button>
          </form>
          <div class="devices" data-devices></div>
        </section>
      </div>`;
    const $ = (s) => U.$(s, ctx.el);
    let classes = {}, weekly = {}, students = {}, bins = {};

    const paint = () => {
      const cur = weekly[wk] || {}, pv = weekly[prev] || {};
      const sum = (o, k) => Object.values(o).reduce((a, c) => a + (Number(c[k]) || 0), 0);
      const cnt = sum(cur, 'count'), pcnt = sum(pv, 'count');
      const delta = cnt - pcnt;
      const stu = Object.values(students);
      const reg = stu.filter((s) => s.uid).length;
      const binList = Object.values(bins);
      const on = binList.filter(GS.svc.binOnline).length;
      $('[data-stats]').innerHTML = `
        <div class="stat stat-leaf"><small>Lượt bỏ rác tuần này</small><b>${U.fmt(cnt)}</b><span>${delta >= 0 ? '+' : ''}${U.fmt(delta)} so với tuần trước</span></div>
        <div class="stat"><small>Điểm cộng tuần này</small><b>${U.fmt(sum(cur, 'points'))}</b><span>${Object.keys(classes).length} lớp thi đua</span></div>
        <div class="stat"><small>Học sinh đã có tài khoản</small><b>${U.fmt(reg)}<em>/${U.fmt(stu.length)}</em></b><span>${stu.length ? Math.round((reg / stu.length) * 100) : 0}% đã đăng ký</span></div>
        <div class="stat"><small>Thùng đang kết nối</small><b>${on}<em>/${binList.length}</em></b><span>${binList.length - on ? `${binList.length - on} thùng chưa gửi tín hiệu` : 'Tất cả hoạt động'}</span></div>`;
      const weeks = []; for (let i = 7; i >= 0; i--) weeks.push(U.prevWeek(wk, i));
      $('[data-chart]').innerHTML = weekChart(weekly, weeks);
      A.bindChartTips($('[data-chart]'));
      const ranked = GS.svc.rankClasses(classes, cur).slice(0, 8);
      $('[data-rank]').innerHTML = ranked.map((c) => `<li><span class="rank">${c.rank}</span><b>${U.esc(c.name)}</b><span class="muted">${U.fmt(c.count)} lượt</span><span class="pts">${U.fmt(c.points)}</span></li>`).join('') || '<li class="empty-row">Chưa có lớp nào</li>';
      $('[data-devices]').innerHTML = `<h3>Thiết bị</h3>` + (binList.map((b) => `<div class="dev"><span class="status ${GS.svc.binOnline(b) ? 'ok' : 'off'}"></span><b>${U.esc(b.id)}</b><span class="muted">${b.lastSeen ? U.timeAgo(b.lastSeen) : 'chưa kết nối'}</span></div>`).join('') || '<p class="muted small">Chưa có thùng nào.</p>');
    };

    const simForm = $('[data-sim]');
    const fillSim = () => {
      const keepBin = simForm.binId.value;
      simForm.binId.innerHTML = Object.values(bins).map((b) => `<option value="${U.esc(b.id)}" ${b.id === keepBin ? 'selected' : ''}>${U.esc(b.id)}, ${U.esc(b.name)}</option>`).join('') || '<option value="">Chưa có thùng</option>';
      $('[data-types]').innerHTML = GS.ui.ruleList().map((r) => `<option value="${U.esc(r.key)}">${U.esc(r.label)} (${U.esc(r.key)})</option>`).join('') + '<option value="paper">Nhãn lạ: paper (thử từ chối)</option>';
    };
    simForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = U.formData(simForm);
      if (!d.binId) { U.toast('Tạo thùng rác trước', 'err'); return; }
      const id = await GS.svc.simulateEvent({ binId: d.binId, type: d.type, studentCode: d.studentCode.trim().toUpperCase() || null });
      U.toast(`Đã gửi sự kiện ${id}`);
    });

    ctx.cleanup(GS.db.on('classes', (v) => { classes = v || {}; paint(); }));
    ctx.cleanup(GS.db.on('weekly', (v) => { weekly = v || {}; paint(); }));
    ctx.cleanup(GS.db.on('students', (v) => {
      students = v || {}; paint();
      $('[data-codes]').innerHTML = Object.values(students).filter((s) => s.uid).slice(0, 300).map((s) => `<option value="${U.esc(s.code)}">${U.esc(s.fullName)}, ${U.esc(s.className)}</option>`).join('');
    }));
    ctx.cleanup(GS.db.on('bins', (v) => { bins = v || {}; paint(); fillSim(); }));
    ctx.cleanup(GS.db.onQuery('events', { orderBy: 'ts', limitToLast: 15 }, (list) => {
      const rows = list.sort((a, b) => b.ts - a.ts);
      $('[data-events]').innerHTML = rows.length ? rows.map((e) => {
        const st = e.studentCode ? students[e.studentCode] : null;
        const stuck = e.status === 'processing' && GS.now() - e.ts > 30e3;
        return `<tr>
          <td class="nowrap">${U.timeAgo(e.ts)}</td><td><code>${U.esc(e.txId || e.id)}</code></td><td class="nowrap">${U.esc(e.binId || '')}</td>
          <td class="nowrap">${A.typeChip(e.type)}</td>
          <td class="minw">${st ? `${U.esc(st.fullName)}<small class="muted block">${U.esc(st.className)}</small>` : e.studentCode ? U.esc(e.studentCode) : '<span class="muted">Theo phiên</span>'}</td>
          <td class="minw">${A.statusChip(e)}${e.status === 'rejected' ? `<small class="muted block">${U.esc(e.reason || '')}</small>` : ''}${stuck ? ` <button class="btn btn-xs btn-ghost" data-retry="${U.esc(e.id)}">Xử lý lại</button>` : ''}</td></tr>`;
      }).join('') : `<tr><td colspan="6" class="empty-row">Chưa có dữ liệu. Khi ESP32 gửi sự kiện lên nhánh <code>events</code>, dòng mới sẽ hiện ở đây.</td></tr>`;
    }));
    ctx.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-retry]');
      if (b) { await GS.db.set(`events/${b.dataset.retry}/status`, 'pending'); U.toast('Đã đưa sự kiện vào hàng chờ'); }
    });
    const t = setInterval(paint, 20e3); ctx.cleanup(() => clearInterval(t));
  }, 'Tổng quan');
})();
