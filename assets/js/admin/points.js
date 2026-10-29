/* Quản trị: Điểm & giao dịch — tổng điểm theo lớp, lịch sử, cộng/trừ điểm, huỷ lượt, xuất Excel */
(function () {
  const GS = window.GS;
  const U = GS.util;
  const A = GS.admin;

  A.route('/admin/points', (ctx) => {
    const thisWeek = U.weekKey(GS.now());
    ctx.el.innerHTML = A.head('Điểm & giao dịch', 'Mỗi lượt bỏ rác đúng là một giao dịch. Huỷ lượt sai hoặc cộng, trừ điểm thủ công tại đây.',
      `<button class="btn btn-ghost danger-text" data-reset>${U.icon('refresh')}Bắt đầu mùa mới</button>
       <button class="btn btn-ghost" data-export>${U.icon('download')}Xuất Excel</button>
       <button class="btn btn-primary" data-adjust>${U.icon('plus')}Cộng / trừ điểm</button>`) + `
      <section class="card flush">
        <div class="card-head pad"><h2>Điểm theo lớp</h2><label class="select-pill"><span class="sr-only">Tuần</span><select data-week></select></label></div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Hạng</th><th>Lớp</th><th>Lượt theo loại</th><th class="r">Lượt</th><th class="r">Điểm tuần</th><th class="r">Điểm cả mùa</th><th></th></tr></thead>
          <tbody data-classes></tbody></table></div>
      </section>
      <section class="card flush section">
        <div class="card-head pad"><h2>Lịch sử giao dịch</h2><span class="muted small" data-count></span></div>
        <div class="filters pad">
          <label class="search">${U.icon('search')}<input type="search" placeholder="Tìm học sinh, mã giao dịch" data-q aria-label="Tìm giao dịch"></label>
          <select data-tcls aria-label="Lọc lớp"></select>
          <select data-ttype aria-label="Lọc loại"></select>
          <select data-tsrc aria-label="Lọc nguồn"><option value="">Mọi nguồn</option><option value="esp32">Thùng rác (ESP32)</option><option value="sim">Lượt thử</option><option value="admin">Điều chỉnh tay</option></select>
        </div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Thời gian</th><th>Học sinh</th><th>Lớp</th><th>Loại</th><th>Thùng</th><th>Nguồn</th><th class="r">Điểm</th><th></th></tr></thead>
          <tbody data-tx></tbody></table></div>
        <div class="more" data-more hidden><button class="btn btn-ghost btn-sm">Xem thêm</button></div>
      </section>`;
    const $ = (s) => U.$(s, ctx.el);
    let classes = {}, weekly = {}, txs = [], week = thisWeek, limit = 80, unTx = null;

    const paintClasses = () => {
      const weeks = Array.from(new Set([thisWeek, ...Object.keys(weekly)])).sort().reverse();
      $('[data-week]').innerHTML = weeks.map((w) => `<option value="${w}" ${w === week ? 'selected' : ''}>Tuần ${U.weekNo(w)} (${U.weekLabel(w)})</option>`).join('') + `<option value="all" ${week === 'all' ? 'selected' : ''}>Tất cả các tuần</option>`;
      const wd = week === 'all' ? null : (weekly[week] || {});
      const ranked = GS.svc.rankClasses(classes, wd);
      const maxCnt = Math.max(1, ...ranked.map((c) => c.count));
      $('[data-classes]').innerHTML = ranked.map((c) => `<tr>
        <td><span class="rank sm">${c.rank}</span></td><td><b>${U.esc(c.name)}</b></td>
        <td class="bar-cell">${GS.ui.stackBar(c.byType, maxCnt, false)}</td>
        <td class="r">${U.fmt(c.count)}</td><td class="r"><b>${week === 'all' ? '-' : U.fmt(c.points)}</b></td><td class="r">${U.fmt((classes[c.id] || {}).points)}</td>
        <td class="r"><button class="btn btn-xs btn-ghost" data-adj-class="${U.esc(c.id)}">Điều chỉnh</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty-row">Chưa có lớp nào.</td></tr>';
      const keep = $('[data-tcls]').value;
      $('[data-tcls]').innerHTML = A.classOptions(classes, keep, 'Tất cả lớp');
    };

    const filteredTx = () => {
      const q = U.normalize($('[data-q]').value), c = $('[data-tcls]').value, t = $('[data-ttype]').value, s = $('[data-tsrc]').value;
      return txs.filter((x) => (!c || x.classId === c) && (!t || x.type === t) && (!s || x.source === s) && (!q || U.normalize(`${x.fullName || ''} ${x.id} ${x.studentCode || ''} ${x.note || ''}`).includes(q)));
    };
    const srcLabel = { esp32: 'Thùng rác', sim: 'Lượt thử', admin: 'Điều chỉnh tay' };
    const paintTx = () => {
      const list = filteredTx();
      $('[data-count]').textContent = `${U.fmt(list.length)} giao dịch, ${week === 'all' ? 'gần nhất' : 'tuần ' + U.weekNo(week)}`;
      $('[data-tx]').innerHTML = list.slice(0, limit).map((x) => `<tr class="${x.revoked ? 'dim strike' : ''}">
        <td class="nowrap">${U.dateTime(x.ts)}<small class="muted block"><code>${U.esc(x.id)}</code></small></td>
        <td>${x.fullName ? U.esc(x.fullName) : '<span class="muted">Cả lớp</span>'}${x.note ? `<small class="muted block">${U.esc(x.note)}</small>` : ''}</td>
        <td>${U.esc(x.className)}</td><td>${A.typeChip(x.type)}</td><td>${U.esc(x.binId || '')}</td>
        <td>${srcLabel[x.source] || U.esc(x.source || '')}${x.revoked ? '<small class="muted block">Đã huỷ</small>' : ''}</td>
        <td class="r"><b class="${x.points >= 0 ? 'plus' : 'minus'}">${x.points >= 0 ? '+' : ''}${x.points}</b></td>
        <td class="r">${x.revoked ? '' : `<button class="btn btn-xs btn-ghost" data-revoke="${U.esc(x.id)}">Huỷ lượt</button>`}</td></tr>`).join('')
        || '<tr><td colspan="8" class="empty-row">Chưa có giao dịch trong khoảng này.</td></tr>';
      $('[data-more]').hidden = list.length <= limit;
    };

    const subTx = () => {
      unTx && unTx();
      const q = week === 'all' ? { orderBy: 'ts', limitToLast: 2000 } : { orderBy: 'weekKey', equalTo: week };
      unTx = GS.db.onQuery('transactions', q, (list) => { txs = list.sort((a, b) => b.ts - a.ts); paintTx(); });
    };
    ctx.cleanup(() => unTx && unTx());

    $('[data-ttype]').innerHTML = '<option value="">Mọi loại</option>' + GS.ui.ruleList().map((r) => `<option value="${U.esc(r.key)}">${U.esc(r.label)}</option>`).join('') + '<option value="manual">Điều chỉnh</option>';
    ctx.cleanup(GS.db.on('classes', (v) => { classes = v || {}; paintClasses(); }));
    ctx.cleanup(GS.db.on('weekly', (v) => { weekly = v || {}; paintClasses(); }));
    subTx();
    $('[data-week]').addEventListener('change', (e) => { week = e.target.value; limit = 80; paintClasses(); subTx(); });
    $('[data-q]').addEventListener('input', U.debounce(paintTx, 150));
    ['[data-tcls]', '[data-ttype]', '[data-tsrc]'].forEach((s) => $(s).addEventListener('change', paintTx));
    U.$('[data-more] button', ctx.el).onclick = () => { limit += 150; paintTx(); };

    const adjustDialog = (classId = '') => U.modal({
      title: 'Cộng / trừ điểm',
      body: `<fieldset class="radio-group inline"><legend>Áp dụng cho</legend>
          <label><input type="radio" name="target" value="class" checked> <span>Cả lớp</span></label>
          <label><input type="radio" name="target" value="student"> <span>Một học sinh</span></label></fieldset>
        <label class="field" data-tclass><span>Lớp</span><select name="classId">${A.classOptions(classes, classId)}</select></label>
        <label class="field" data-tstudent hidden><span>Mã học sinh</span><input name="studentCode" placeholder="10A1-K7Q2" autocapitalize="characters"></label>
        <label class="field"><span>Số điểm</span><input name="points" type="number" step="1" required placeholder="Ví dụ 10 hoặc -5"><small class="hint">Số âm để trừ điểm. Không làm thay đổi số lượt bỏ rác.</small></label>
        <label class="field"><span>Lý do</span><input name="note" required placeholder="Thưởng tuần lễ xanh, trừ do bỏ rác sai…"></label>`,
      actions: [{ label: 'Huỷ' }, { label: 'Lưu điều chỉnh', kind: 'primary', submit: true }],
      onOpen: (ov) => U.$$('input[name=target]', ov).forEach((r) => { r.onchange = () => { const s = r.value === 'student' && r.checked; U.$('[data-tstudent]', ov).hidden = !s; U.$('[data-tclass]', ov).hidden = s; }; }),
      onSubmit: async (f) => {
        const d = U.formData(f);
        if (!d.note.trim()) throw new Error('Ghi lý do để lớp biết vì sao điểm thay đổi');
        await GS.svc.adjustPoints(d.target === 'student' ? { studentCode: d.studentCode.trim().toUpperCase(), points: d.points, note: d.note } : { classId: d.classId, points: d.points, note: d.note });
        U.toast('Đã lưu điều chỉnh điểm');
      }
    });
    $('[data-adjust]').onclick = () => adjustDialog();

    $('[data-export]').onclick = async () => {
      const XLSX = await U.libs.xlsx();
      const wb = XLSX.utils.book_new();
      const tx = filteredTx().map((x) => ({ 'Thời gian': U.dateTime(x.ts), 'Tuần': x.weekKey, 'Mã giao dịch': x.id, 'Mã học sinh': x.studentCode || '', 'Họ và tên': x.fullName || '', 'Lớp': x.className, 'Loại rác': x.typeLabel || GS.ui.ruleLabel(x.type), 'Nhãn mô hình': x.type, 'Thùng': x.binId || '', 'Nguồn': srcLabel[x.source] || x.source || '', 'Điểm': x.points, 'Đã huỷ': x.revoked ? 'Có' : '', 'Ghi chú': x.note || '' }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tx), 'Giao dịch');
      const rules = GS.ui.ruleList();
      const weeklyRows = [];
      Object.entries(weekly).sort().forEach(([w, cls]) => Object.entries(cls).forEach(([c, v]) => {
        const row = { 'Tuần': w, 'Từ ngày – đến ngày': U.weekLabel(w), 'Lớp': (classes[c] || {}).name || c, 'Lượt': v.count || 0, 'Điểm': v.points || 0 };
        rules.forEach((r) => { row[`Lượt ${r.label}`] = (v.byType || {})[r.key] || 0; });
        weeklyRows.push(row);
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(weeklyRows), 'Tổng hợp tuần');
      XLSX.writeFile(wb, `diem-thi-dua-${week}.xlsx`);
    };

    $('[data-reset]').onclick = async () => {
      if (await U.confirm('Bắt đầu mùa thi đua mới?', 'Toàn bộ điểm, lượt bỏ rác và lịch sử giao dịch sẽ bị xoá. Học sinh và tài khoản giữ nguyên. Nên Xuất Excel để lưu lại trước.', { okLabel: 'Xoá điểm, bắt đầu mùa mới', danger: true, typeText: 'MUA MOI' })) {
        await GS.svc.resetSeason(); U.toast('Đã bắt đầu mùa thi đua mới');
      }
    };

    ctx.el.addEventListener('click', async (e) => {
      const r = e.target.closest('[data-revoke]');
      if (r) {
        const v = await U.modal({ title: 'Huỷ lượt này?', body: `<p class="muted">Điểm và số lượt của giao dịch <code>${U.esc(r.dataset.revoke)}</code> sẽ được trừ lại khỏi học sinh và lớp.</p><label class="field"><span>Lý do</span><input name="reason" placeholder="Bỏ rác sai loại, thử nghiệm…"></label>`,
          actions: [{ label: 'Không huỷ', value: null }, { label: 'Huỷ lượt', kind: 'danger', submit: true }], onSubmit: (f) => ({ reason: f.reason.value }) });
        if (v) { await GS.svc.revokeTx(r.dataset.revoke, v.reason); U.toast('Đã huỷ lượt và trừ điểm'); }
      }
      const a = e.target.closest('[data-adj-class]');
      if (a) adjustDialog(a.dataset.adjClass);
    });
  }, 'Điểm & giao dịch');
})();
