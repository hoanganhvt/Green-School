/* Quản trị: Học sinh & mã — nhập Excel, tự tạo mã học sinh, xuất/in phiếu mã */
(function () {
  const GS = window.GS;
  const U = GS.util;
  const A = GS.admin;

  /* ---------- Đọc file Excel ---------- */
  /* Nhận diện tiêu đề cột (đã bỏ dấu, viết thường) */
  const colKind = (n) => {
    if (/^(stt|tt|so tt|so thu tu)$/.test(n)) return null;
    if (/(ma hs|ma hoc sinh|ma so hoc sinh|student ?code|^ma so$|^ma$)/.test(n)) return 'code';
    if (/^ho( va)?( ten)? ?(dem|lot)$|^ho va ten (dem|lot)$|^ho$/.test(n)) return 'last';
    if (/^ten$|^ten goi$|^first ?name$/.test(n)) return 'first';
    if (/^(ho va ten|ho ten|ho va ten hoc sinh|ten hoc sinh|hoc sinh|full ?name|name)$/.test(n)) return 'full';
    if (/^(lop|class)/.test(n)) return 'cls';
    if (/(ngay sinh|nam sinh|dob|birth)/.test(n)) return 'dob';
    if (/(gioi tinh|^gt$|gender|^phai$)/.test(n)) return 'gender';
    return null;
  };
  const looksLikeClass = (s) => /^\d{1,2}\s*[a-zA-Z]{1,3}\d{0,2}$/.test(String(s).trim());

  const fmtDob = (v) => {
    if (!v) return '';
    if (v instanceof Date && !isNaN(v)) return `${String(v.getDate()).padStart(2, '0')}/${String(v.getMonth() + 1).padStart(2, '0')}/${v.getFullYear()}`;
    return String(v).trim();
  };

  A.parseWorkbook = async (file) => {
    const XLSX = await U.libs.xlsx();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const rows = [], report = [];
    wb.SheetNames.forEach((name) => {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true });
      let hIdx = -1, map = {};
      for (let i = 0; i < Math.min(20, aoa.length); i++) {
        const m = {};
        aoa[i].forEach((cell, j) => {
          const n = U.normalize(cell);
          if (!n) return;
          const k = colKind(n);
          if (k && m[k] === undefined) m[k] = j;
        });
        if (m.full !== undefined || (m.last !== undefined && m.first !== undefined)) { hIdx = i; map = m; break; }
      }
      if (hIdx < 0) { report.push({ sheet: name, ok: false, note: 'Không thấy cột Họ và tên' }); return; }
      const sheetClass = looksLikeClass(name) ? name : '';
      let n = 0;
      for (let i = hIdx + 1; i < aoa.length; i++) {
        const r = aoa[i];
        const full = map.full !== undefined ? String(r[map.full] || '').trim() : `${String(r[map.last] || '').trim()} ${String(r[map.first] || '').trim()}`.trim();
        if (!full || /^\d+$/.test(full)) continue;
        const cls = map.cls !== undefined ? String(r[map.cls] || '').trim() : sheetClass;
        rows.push({ fullName: full, className: cls, dob: map.dob !== undefined ? fmtDob(r[map.dob]) : '', gender: map.gender !== undefined ? String(r[map.gender] || '').trim() : '', code: map.code !== undefined ? String(r[map.code] || '').trim() : '', _sheet: name, _row: i + 1 });
        n++;
      }
      const cols = Object.entries(map).map(([k, j]) => `${({ full: 'Họ và tên', last: 'Họ', first: 'Tên', cls: 'Lớp', dob: 'Ngày sinh', gender: 'Giới tính', code: 'Mã HS' })[k]}: cột ${XLSX.utils.encode_col(j)}`).join(', ');
      report.push({ sheet: name, ok: true, count: n, note: cols + (map.cls === undefined ? (sheetClass ? `, lớp lấy theo tên sheet (${sheetClass})` : ', không có cột Lớp') : '') });
    });
    return { rows, report };
  };

  A.downloadTemplate = async () => {
    const XLSX = await U.libs.xlsx();
    const ws = XLSX.utils.aoa_to_sheet([
      ['STT', 'Họ và tên', 'Lớp', 'Ngày sinh', 'Giới tính'],
      [1, 'Nguyễn Văn An', '10A1', '12/03/2010', 'Nam'],
      [2, 'Trần Thị Bích Ngọc', '10A1', '05/09/2010', 'Nữ'],
      [3, 'Lê Hoàng Minh', '11A2', '21/11/2009', 'Nam']
    ]);
    ws['!cols'] = [{ wch: 5 }, { wch: 28 }, { wch: 8 }, { wch: 12 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Danh sách');
    XLSX.writeFile(wb, 'mau-danh-sach-hoc-sinh.xlsx');
  };

  A.exportCodes = async (students, filename = 'ma-hoc-sinh.xlsx') => {
    const XLSX = await U.libs.xlsx();
    const list = students.slice().sort((a, b) => String(a.className).localeCompare(String(b.className), 'vi', { numeric: true }) || String(a.fullName).split(' ').pop().localeCompare(String(b.fullName).split(' ').pop(), 'vi'));
    const toRows = (arr) => arr.map((s, i) => ({ 'STT': i + 1, 'Mã học sinh': s.code, 'Họ và tên': s.fullName, 'Lớp': s.className, 'Trạng thái': s.uid ? 'Đã đăng ký' : 'Chưa đăng ký', 'Tên đăng nhập': s.username || '' }));
    const wb = XLSX.utils.book_new();
    const cols = [{ wch: 5 }, { wch: 14 }, { wch: 28 }, { wch: 8 }, { wch: 14 }, { wch: 18 }];
    const all = XLSX.utils.json_to_sheet(toRows(list)); all['!cols'] = cols;
    XLSX.utils.book_append_sheet(wb, all, 'Tất cả');
    const byClass = {};
    list.forEach((s) => { (byClass[s.className] = byClass[s.className] || []).push(s); });
    Object.entries(byClass).forEach(([c, arr]) => { const ws = XLSX.utils.json_to_sheet(toRows(arr)); ws['!cols'] = cols; XLSX.utils.book_append_sheet(wb, ws, String(c).slice(0, 31)); });
    XLSX.writeFile(wb, filename);
  };

  A.printSlips = async (students) => {
    const qrcode = await U.libs.qr().catch(() => null);
    const s = GS.state.settings;
    const base = (String(s.baseUrl || '').trim() || location.origin + location.pathname).replace(/#.*$/, '');
    const list = students.slice().sort((a, b) => String(a.className).localeCompare(String(b.className), 'vi', { numeric: true }) || String(a.fullName).split(' ').pop().localeCompare(String(b.fullName).split(' ').pop(), 'vi'));
    const qrSvg = (txt) => { if (!qrcode) return ''; const q = qrcode(0, 'M'); q.addData(txt); q.make(); return q.createSvgTag({ cellSize: 2, margin: 0, scalable: true }); };
    U.print(`<div class="slips">${list.map((st) => `
      <div class="slip">
        <div class="slip-txt">
          <b class="slip-app">${U.esc(s.appName)}</b>
          <span class="slip-name">${U.esc(st.fullName)}</span>
          <span>Lớp ${U.esc(st.className)}</span>
          <span class="slip-code">${U.esc(st.code)}</span>
          <small>Quét mã bên cạnh hoặc vào trang web, chọn Đăng ký, nhập mã này cùng họ tên và lớp.</small>
        </div>
        <div class="slip-qr">${qrSvg(`${base}#/register?code=${encodeURIComponent(st.code)}`)}</div>
      </div>`).join('')}</div>`, 'Phiếu mã học sinh');
  };

  /* ---------- Hộp thoại nhập Excel ---------- */
  const importDialog = (onDone) => U.modal({
    title: 'Nhập danh sách học sinh từ Excel',
    wide: true,
    body: `<div data-step1>
        <label class="drop" data-drop>
          ${U.icon('upload', 'ic-xl')}
          <b>Chọn hoặc kéo thả file Excel vào đây</b>
          <small class="muted">Hỗ trợ .xlsx, .xls, .csv. Cần có cột Họ và tên (hoặc Họ + Tên) và cột Lớp. Nếu mỗi lớp nằm ở một sheet, tên sheet sẽ được dùng làm tên lớp.</small>
          <input type="file" accept=".xlsx,.xls,.csv" hidden data-file>
        </label>
        <button type="button" class="btn btn-ghost btn-sm" data-template>${U.icon('download')}Tải file mẫu</button>
      </div>
      <div data-step2 hidden></div>`,
    actions: [{ label: 'Đóng', value: null }],
    onOpen: (ov) => {
      const drop = U.$('[data-drop]', ov), input = U.$('[data-file]', ov);
      U.$('[data-template]', ov).onclick = A.downloadTemplate;
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); });
      input.addEventListener('change', () => input.files[0] && handle(input.files[0]));

      const handle = async (file) => {
        const step2 = U.$('[data-step2]', ov);
        step2.hidden = false; step2.innerHTML = '<p class="muted">Đang đọc file…</p>';
        let parsed;
        try { parsed = await A.parseWorkbook(file); } catch (e) { step2.innerHTML = `<p class="form-err">Không đọc được file: ${U.esc(e.message)}</p>`; return; }
        const { rows, report } = parsed;
        const noClass = rows.filter((r) => !r.className).length;
        const classes = Array.from(new Set(rows.filter((r) => r.className).map((r) => U.className(r.className)))).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
        U.$('[data-step1]', ov).hidden = true;
        step2.innerHTML = `
          <div class="import-sum">
            <div><b>${U.esc(file.name)}</b><span class="muted">${rows.length} học sinh, ${classes.length} lớp</span></div>
            <button type="button" class="btn btn-ghost btn-sm" data-again>Chọn file khác</button>
          </div>
          <ul class="sheet-report">${report.map((r) => `<li class="${r.ok ? '' : 'bad'}"><b>${U.esc(r.sheet)}</b>: ${r.ok ? `${r.count} dòng. ${U.esc(r.note)}` : U.esc(r.note)}</li>`).join('')}</ul>
          ${classes.length ? `<p class="class-tags">${classes.map((c) => `<span class="tag">${U.esc(c)}</span>`).join('')}</p>` : ''}
          ${noClass ? `<p class="form-err">${noClass} dòng không có lớp sẽ bị bỏ qua.</p>` : ''}
          <div class="table-wrap short"><table class="tbl"><thead><tr><th>Dòng</th><th>Họ và tên</th><th>Lớp</th><th>Ngày sinh</th><th>Giới tính</th></tr></thead>
          <tbody>${rows.slice(0, 8).map((r) => `<tr><td>${U.esc(r._sheet)}:${r._row}</td><td>${U.esc(U.titleCase(r.fullName))}</td><td>${U.esc(U.className(r.className))}</td><td>${U.esc(r.dob)}</td><td>${U.esc(r.gender)}</td></tr>`).join('')}
          ${rows.length > 8 ? `<tr><td colspan="5" class="muted">và ${rows.length - 8} học sinh khác…</td></tr>` : ''}</tbody></table></div>
          <fieldset class="radio-group"><legend>Cách nhập</legend>
            <label><input type="radio" name="mode" value="append" checked> <span><b>Thêm vào danh sách hiện có</b><small>Bỏ qua học sinh trùng họ tên trong cùng lớp. Mã cũ giữ nguyên.</small></span></label>
            <label><input type="radio" name="mode" value="replace"> <span><b>Thay toàn bộ danh sách</b><small>Xoá học sinh cũ, tạo mã mới. Tài khoản cũ phải đăng ký lại. Điểm của lớp vẫn giữ.</small></span></label>
          </fieldset>
          <div class="row-btns"><button type="button" class="btn btn-primary" data-go ${rows.length ? '' : 'disabled'}>${U.icon('check')}Nhập ${rows.length} học sinh và tạo mã</button></div>
          <div data-result></div>`;
        U.$('[data-again]', ov).onclick = () => { step2.hidden = true; U.$('[data-step1]', ov).hidden = false; input.value = ''; };
        U.$('[data-go]', ov).onclick = async (e) => {
          const replace = U.$('input[name=mode]:checked', ov).value === 'replace';
          if (replace && !(await U.confirm('Thay toàn bộ danh sách?', 'Toàn bộ học sinh hiện có sẽ bị xoá và tạo mã mới. Học sinh đã đăng ký sẽ phải đăng ký lại bằng mã mới.', { okLabel: 'Thay danh sách', danger: true, typeText: 'THAY' }))) return;
          e.target.disabled = true; e.target.textContent = 'Đang nhập…';
          try {
            const res = await GS.svc.importStudents(rows.filter((r) => r.className), { replace });
            U.$('[data-result]', ov).innerHTML = `<div class="result-box">
              <p><b>Đã thêm ${res.added.length} học sinh</b> và tạo mã cho từng bạn.${res.skipped.length ? ` Bỏ qua ${res.skipped.length} dòng (trùng hoặc thiếu thông tin).` : ''}</p>
              <div class="row-btns"><button type="button" class="btn btn-primary btn-sm" data-dl>${U.icon('download')}Tải danh sách mã vừa tạo</button><button type="button" class="btn btn-ghost btn-sm" data-pr>${U.icon('print')}In phiếu mã</button></div></div>`;
            U.$('[data-dl]', ov).onclick = () => A.exportCodes(res.added, 'ma-hoc-sinh-moi.xlsx');
            U.$('[data-pr]', ov).onclick = () => A.printSlips(res.added);
            e.target.textContent = 'Đã nhập xong';
            U.toast(`Đã thêm ${res.added.length} học sinh`);
            onDone && onDone();
          } catch (err) { U.toast(GS.svc.errMsg(err), 'err'); e.target.disabled = false; e.target.textContent = 'Thử lại'; }
        };
      };
    }
  });

  const studentForm = (st = {}, classes) => `
    <label class="field"><span>Họ và tên</span><input name="fullName" required value="${U.esc(st.fullName || '')}"></label>
    <div class="grid-2">
      <label class="field"><span>Lớp</span><input name="className" required list="dl-cls" value="${U.esc(st.className || '')}" placeholder="10A1" autocapitalize="characters"><datalist id="dl-cls">${Object.values(classes).map((c) => `<option value="${U.esc(c.name)}">`).join('')}</datalist></label>
      <label class="field"><span>Giới tính</span><select name="gender"><option value="">Không ghi</option>${['Nam', 'Nữ'].map((g) => `<option ${st.gender === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
    </div>
    <label class="field"><span>Ngày sinh</span><input name="dob" value="${U.esc(st.dob || '')}" placeholder="dd/mm/yyyy"></label>
    ${st.code ? `<p class="hint">Đổi lớp không chuyển điểm cũ: điểm đã cộng vẫn thuộc lớp trước đó.</p>` : ''}`;

  /* ---------- Trang Học sinh & mã ---------- */
  A.route('/admin/students', (ctx) => {
    ctx.el.innerHTML = A.head('Học sinh & mã', 'Danh sách học sinh tham gia thi đua. Mỗi bạn có một mã riêng để tự đăng ký tài khoản.',
      `<button class="btn btn-ghost" data-act="export">${U.icon('download')}Xuất mã</button>
       <button class="btn btn-ghost" data-act="print">${U.icon('print')}In phiếu mã</button>
       <button class="btn btn-ghost" data-act="add">${U.icon('plus')}Thêm học sinh</button>
       <button class="btn btn-primary" data-act="import">${U.icon('upload')}Nhập từ Excel</button>`) + `
      <div class="filters">
        <label class="search">${U.icon('search')}<input type="search" placeholder="Tìm theo tên hoặc mã" data-q aria-label="Tìm học sinh"></label>
        <select data-cls aria-label="Lọc theo lớp"></select>
        <select data-reg aria-label="Lọc theo trạng thái"><option value="">Mọi trạng thái</option><option value="yes">Đã đăng ký</option><option value="no">Chưa đăng ký</option></select>
        <span class="muted small" data-count></span>
      </div>
      <div class="card flush"><div class="table-wrap"><table class="tbl">
        <thead><tr><th>Mã học sinh</th><th>Họ và tên</th><th>Lớp</th><th>Tài khoản</th><th class="r">Lượt</th><th class="r">Điểm</th><th></th></tr></thead>
        <tbody data-rows></tbody></table></div>
        <div class="more" data-more hidden><button class="btn btn-ghost btn-sm">Xem thêm</button></div></div>`;
    const $ = (s) => U.$(s, ctx.el);
    let students = {}, classes = {}, limit = 60;

    const filtered = () => {
      const q = U.normalize($('[data-q]').value), c = $('[data-cls]').value, r = $('[data-reg]').value;
      return Object.values(students).filter((s) => (!c || s.classId === c) && (!r || (r === 'yes' ? !!s.uid : !s.uid)) && (!q || U.normalize(s.fullName).includes(q) || U.normalize(s.code).includes(q)))
        .sort((a, b) => String(a.className).localeCompare(String(b.className), 'vi', { numeric: true }) || String(a.fullName).split(' ').pop().localeCompare(String(b.fullName).split(' ').pop(), 'vi'));
    };
    const paint = () => {
      const list = filtered();
      $('[data-count]').textContent = `${U.fmt(list.length)} học sinh`;
      $('[data-rows]').innerHTML = list.slice(0, limit).map((s) => `<tr>
        <td><code class="code">${U.esc(s.code)}</code></td>
        <td><b>${U.esc(s.fullName)}</b>${s.dob || s.gender ? `<small class="muted block">${U.esc([s.gender, s.dob].filter(Boolean).join(', '))}</small>` : ''}</td>
        <td>${U.esc(s.className)}</td>
        <td>${s.uid ? `<span class="pill pill-ok">@${U.esc(s.username || '')}</span>` : '<span class="pill">Chưa đăng ký</span>'}</td>
        <td class="r">${U.fmt(s.count)}</td><td class="r"><b>${U.fmt(s.points)}</b></td>
        <td class="r nowrap"><button class="icon-btn" data-edit="${U.esc(s.code)}" title="Sửa" aria-label="Sửa ${U.esc(s.fullName)}">${U.icon('edit')}</button><button class="icon-btn danger" data-del="${U.esc(s.code)}" title="Xoá" aria-label="Xoá ${U.esc(s.fullName)}">${U.icon('trash')}</button></td></tr>`).join('')
        || `<tr><td colspan="7" class="empty-row">${Object.keys(students).length ? 'Không có học sinh khớp bộ lọc.' : 'Chưa có học sinh nào. Bấm Nhập từ Excel để thêm cả trường trong một lần.'}</td></tr>`;
      $('[data-more]').hidden = list.length <= limit;
    };

    ctx.cleanup(GS.db.on('students', (v) => { students = v || {}; paint(); }));
    ctx.cleanup(GS.db.on('classes', (v) => { classes = v || {}; const keep = $('[data-cls]').value; $('[data-cls]').innerHTML = A.classOptions(classes, keep, 'Tất cả lớp'); }));
    $('[data-q]').addEventListener('input', U.debounce(() => { limit = 60; paint(); }, 150));
    $('[data-cls]').addEventListener('change', paint);
    $('[data-reg]').addEventListener('change', paint);
    U.$('[data-more] button', ctx.el).onclick = () => { limit += 100; paint(); };

    ctx.el.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]');
      if (act) {
        const a = act.dataset.act;
        if (a === 'import') importDialog();
        if (a === 'export') { const l = filtered(); if (!l.length) return U.toast('Không có học sinh để xuất', 'warn'); A.exportCodes(l); }
        if (a === 'print') { const l = filtered(); if (!l.length) return U.toast('Không có học sinh để in', 'warn'); A.printSlips(l); }
        if (a === 'add') U.modal({ title: 'Thêm học sinh', body: studentForm({}, classes), actions: [{ label: 'Huỷ' }, { label: 'Thêm và tạo mã', kind: 'primary', submit: true }],
          onSubmit: async (f) => { const st = await GS.svc.addStudent(U.formData(f)); U.toast(`Đã tạo mã ${st.code} cho ${st.fullName}`); } });
      }
      const ed = e.target.closest('[data-edit]');
      if (ed) {
        const st = students[ed.dataset.edit];
        U.modal({ title: `Sửa học sinh ${st.code}`, body: studentForm(st, classes), actions: [{ label: 'Huỷ' }, { label: 'Lưu thay đổi', kind: 'primary', submit: true }],
          onSubmit: async (f) => { await GS.svc.updateStudent(st.code, U.formData(f)); U.toast('Đã lưu thay đổi'); } });
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        const st = students[del.dataset.del];
        if (await U.confirm('Xoá học sinh?', `Xoá ${U.esc(st.fullName)} (${U.esc(st.code)}) khỏi danh sách${st.uid ? ' và xoá luôn tài khoản @' + U.esc(st.username) : ''}. Điểm đã góp cho lớp vẫn giữ.`, { okLabel: 'Xoá học sinh', danger: true })) {
          await GS.svc.deleteStudent(st.code); U.toast('Đã xoá học sinh');
        }
      }
    });
  }, 'Học sinh & mã');
})();
