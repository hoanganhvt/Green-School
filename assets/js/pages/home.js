/* Trang chủ: bục vinh danh + bảng xếp hạng thi đua giữa các lớp (thời gian thực) */
(function () {
  const GS = window.GS;
  const U = GS.util;

  GS.ui = GS.ui || {};
  /* Danh sách loại rác theo thứ tự hiển thị */
  GS.ui.ruleList = () => Object.entries(GS.state.settings.rules || {})
    .map(([key, r]) => ({ key, ...r }))
    .sort((a, b) => (a.order || 99) - (b.order || 99));
  GS.ui.ruleColor = (key) => { const r = (GS.state.settings.rules || {})[key]; return r && r.color ? r.color : '#7C8B83'; };
  GS.ui.ruleLabel = (key) => { const r = (GS.state.settings.rules || {})[key]; return r ? r.label : (key === 'manual' ? 'Điều chỉnh' : key); };
  GS.ui.typeIcon = (key) => (key === 'metal' ? 'can' : key === 'plastic' ? 'bottle' : key === 'manual' ? 'edit' : 'bin');

  GS.ui.stackBar = (byType, max, label = true) => {
    const rules = GS.ui.ruleList();
    const total = rules.reduce((s, r) => s + (Number(byType[r.key]) || 0), 0);
    const parts = rules.map((r) => ({ r, n: Number(byType[r.key]) || 0 })).filter((x) => x.n > 0);
    const tip = parts.length ? parts.map((x) => `${x.r.label}: ${U.fmt(x.n)} lượt`).join(', ') : 'Chưa có lượt nào';
    return `<span class="stack" role="img" aria-label="${U.esc(tip)}" title="${U.esc(tip)}">${parts.map((x) =>
      `<i style="width:${max ? (x.n / max) * 100 : 0}%;background:${x.r.color}"></i>`).join('')}${label && !total ? '<em>chưa có lượt</em>' : ''}</span>`;
  };

  const binHTML = (c, rank, maxPts, empty) => {
    const fill = empty || !maxPts ? 4 : Math.max(10, Math.round((c.points / maxPts) * 86));
    return `<div class="pod pod-${rank}">
      <div class="pod-bin" style="--fill:${fill}%">
        <span class="pod-lid"></span>
        <span class="pod-body"><span class="pod-fill"></span><span class="pod-tag">${U.esc(empty ? '?' : c.name)}</span></span>
      </div>
      <div class="pod-step"><b>${rank}</b><span>${empty ? '0 điểm' : `${U.fmt(c.points)} điểm`}</span></div>
    </div>`;
  };

  GS.route('/', (ctx) => {
    const s = GS.state.settings;
    const thisWeek = U.weekKey(GS.now());
    const lastWeek = U.prevWeek(thisWeek);
    let view = ctx.query.w || thisWeek; // khoá tuần hoặc 'all'
    let classes = {}, weekly = {}, feed = [], firstPaint = true;

    ctx.el.innerHTML = `
      <section class="hero wrap">
        <div class="hero-copy">
          <span class="chip chip-leaf">${U.icon('leaf')}${U.esc(s.seasonName)}</span>
          <h1 class="hero-title">Lớp nào xanh nhất tuần này?</h1>
          <p class="lead">${U.esc(s.slogan)}. Quét mã QR trên thùng, bỏ chai nhựa hoặc lon kim loại vào, điểm tự cộng cho lớp của bạn.</p>
          <div class="hero-cta">
            <a class="btn btn-primary btn-lg" href="#/scan">${U.icon('qr')}Quét mã thùng rác</a>
            ${GS.state.user ? `<a class="btn btn-ghost btn-lg" href="#/me">${U.icon('user')}Điểm của tôi</a>` : `<a class="btn btn-ghost btn-lg" href="#/register">Đăng ký bằng mã học sinh</a>`}
          </div>
          <p class="hero-facts" data-facts></p>
        </div>
        <div class="podium-wrap">
          <div class="podium" data-podium aria-live="polite"></div>
          <div class="ground"></div>
        </div>
      </section>

      <section class="wrap section" aria-labelledby="board-title">
        <div class="board-head">
          <div>
            <h2 id="board-title">Bảng xếp hạng thi đua</h2>
            <p class="muted" data-board-sub></p>
          </div>
          <div class="board-tools">
            <div class="seg" role="tablist" aria-label="Khoảng thời gian">
              <button role="tab" data-view="${thisWeek}">Tuần này</button>
              <button role="tab" data-view="${lastWeek}">Tuần trước</button>
              <button role="tab" data-view="all">Cả mùa</button>
            </div>
            <label class="select-pill"><span class="sr-only">Chọn tuần</span><select data-week></select></label>
          </div>
        </div>
        <div class="legend" data-legend></div>
        <div class="board-cols" aria-hidden="true"><span>Hạng</span><span>Lớp</span><span>Lượt bỏ rác theo loại</span><span>Lượt</span><span>Điểm</span></div>
        <ol class="board" data-board></ol>
      </section>

      <section class="wrap section split">
        <div class="panel">
          <div class="panel-head"><h2>Vừa bỏ rác</h2><span class="live-dot">Trực tiếp</span></div>
          <ul class="feed" data-feed></ul>
        </div>
        <div class="panel panel-rules">
          <div class="panel-head"><h2>Mỗi lượt được bao nhiêu điểm?</h2></div>
          <ul class="rule-list" data-rules></ul>
          <p class="muted small">Camera nhận diện đúng loại rác và cảm biến xác nhận rác đã vào thùng thì lượt mới được tính. Điểm của bạn cộng thẳng vào lớp.</p>
        </div>
      </section>

      <section class="wrap section how" aria-labelledby="how-title">
        <h2 id="how-title">Tích điểm trong bốn bước</h2>
        <ol class="steps">
          <li><span class="step-n">1</span><h3>Quét mã QR trên thùng</h3><p>Mỗi thùng có một mã riêng dán ở nắp. Mở camera điện thoại hoặc nút Quét mã trong app.</p></li>
          <li><span class="step-n">2</span><h3>Đăng nhập tài khoản</h3><p>Dùng tên đăng nhập và mật khẩu bạn đã tạo từ mã học sinh. Thùng sẽ ghi nhận bạn trong vài phút.</p></li>
          <li><span class="step-n">3</span><h3>Bỏ rác vào thùng</h3><p>Camera nhận diện nhựa hay kim loại, nắp tự mở và đèn báo đúng loại rác.</p></li>
          <li><span class="step-n">4</span><h3>Điểm về lớp ngay lập tức</h3><p>Điểm hiện trên điện thoại của bạn và bảng xếp hạng chỉ sau một hai giây.</p></li>
        </ol>
      </section>`;

    const $ = (sel) => U.$(sel, ctx.el);

    const paint = () => {
      const isAll = view === 'all';
      const weekData = isAll ? null : (weekly[view] || {});
      const ranked = GS.svc.rankClasses(classes, weekData);
      const myClass = GS.state.user && GS.state.user.classId;
      const rules = GS.ui.ruleList();

      /* Tab đang chọn */
      U.$$('[data-view]', ctx.el).forEach((b) => b.setAttribute('aria-selected', b.dataset.view === view ? 'true' : 'false'));
      const weeks = Array.from(new Set([thisWeek, ...Object.keys(weekly)])).sort().reverse();
      $('[data-week]').innerHTML = `<option value="all" ${isAll ? 'selected' : ''}>Cả mùa</option>` + weeks.map((w) =>
        `<option value="${w}" ${w === view ? 'selected' : ''}>Tuần ${U.weekNo(w)} (${U.weekLabel(w)})</option>`).join('');
      $('[data-board-sub]').textContent = isAll ? `Tổng điểm tích luỹ từ đầu ${s.seasonName.toLowerCase()}` : `Tuần ${U.weekNo(view)}, từ ${U.weekLabel(view).replace(' – ', ' đến ')}`;

      /* Bục vinh danh luôn là tuần đang xem */
      const top = ranked.slice(0, 3);
      const maxPts = top[0] ? top[0].points : 0;
      const empty = (c) => !c || (!c.points && !c.count);
      const order = [[top[1], 2], [top[0], 1], [top[2], 3]];
      const pod = $('[data-podium]');
      pod.innerHTML = order.map(([c, r]) => binHTML(c || {}, r, maxPts, empty(c))).join('');
      pod.setAttribute('aria-label', top.length ? `Top 3: ${top.map((c) => `hạng ${c.rank} lớp ${c.name}, ${c.points} điểm`).join('; ')}` : 'Chưa có dữ liệu');
      if (firstPaint) {
        pod.classList.add('rising');
        requestAnimationFrame(() => requestAnimationFrame(() => pod.classList.remove('rising')));
        firstPaint = false;
      }

      const totPts = ranked.reduce((a, c) => a + c.points, 0);
      const totCnt = ranked.reduce((a, c) => a + c.count, 0);
      $('[data-facts]').innerHTML = `<b>${U.fmt(totCnt)}</b> lượt bỏ rác và <b>${U.fmt(totPts)}</b> điểm ${isAll ? 'cả mùa' : view === thisWeek ? 'tuần này' : `tuần ${U.weekNo(view)}`}, ${ranked.length} lớp tham gia.`;

      $('[data-legend]').innerHTML = rules.map((r) => `<span><i style="background:${r.color}"></i>${U.esc(r.label)}</span>`).join('');
      const maxCnt = Math.max(1, ...ranked.map((c) => c.count));
      $('[data-board]').innerHTML = ranked.length ? ranked.map((c) => `
        <li class="row ${c.rank <= 3 && c.points ? 'top top-' + c.rank : ''} ${c.id === myClass ? 'mine' : ''}">
          <span class="rank" aria-label="Hạng ${c.rank}">${c.rank}</span>
          <span class="cls"><b>${U.esc(c.name)}</b>${c.id === myClass ? '<em class="tag">Lớp bạn</em>' : `<small>Khối ${c.grade || '?'}</small>`}</span>
          ${GS.ui.stackBar(c.byType, maxCnt)}
          <span class="num cnt"><b>${U.fmt(c.count)}</b><small>lượt</small></span>
          <span class="num pts"><b>${U.fmt(c.points)}</b><small>điểm</small></span>
        </li>`).join('') : `<li class="empty-row">Chưa có lớp nào. Quản trị viên cần nhập danh sách học sinh trước.</li>`;

      $('[data-rules]').innerHTML = rules.filter((r) => r.enabled !== false).map((r) =>
        `<li><span class="rule-ic" style="--c:${r.color}">${U.icon(GS.ui.typeIcon(r.key))}</span><span><b>${U.esc(r.label)}</b><small>mỗi lượt bỏ đúng thùng</small></span><span class="rule-pts">+${r.points}<small>điểm</small></span></li>`).join('');
    };

    const known = new Set();
    let firstFeed = true;
    const paintFeed = () => {
      const items = feed.filter((t) => !t.revoked && t.countable).slice().reverse().slice(0, 7);
      $('[data-feed]').innerHTML = items.length ? items.map((t) => {
        const fresh = !firstFeed && !known.has(t.id);
        known.add(t.id);
        return `<li class="${fresh ? 'fresh' : ''}"><span class="feed-ic" style="--c:${GS.ui.ruleColor(t.type)}">${U.icon(GS.ui.typeIcon(t.type))}</span>
          <span class="feed-txt"><b>${U.esc(U.shortName(t.fullName))}</b> lớp ${U.esc(t.className)} bỏ rác ${U.esc((t.typeLabel || GS.ui.ruleLabel(t.type)).toLowerCase())}<small>${U.timeAgo(t.ts)}</small></span>
          <span class="feed-pts">+${t.points}</span></li>`;
      }).join('') : '<li class="empty-row">Chưa có lượt bỏ rác nào. Lượt đầu tiên sẽ hiện ở đây ngay khi thùng gửi dữ liệu.</li>';
      firstFeed = false;
    };

    ctx.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (b) { view = b.dataset.view; paint(); }
    });
    $('[data-week]').addEventListener('change', (e) => { view = e.target.value; paint(); });

    ctx.cleanup(GS.db.on('classes', (v) => { classes = v || {}; paint(); }));
    ctx.cleanup(GS.db.on('weekly', (v) => { weekly = v || {}; paint(); }));
    ctx.cleanup(GS.db.onQuery('transactions', { orderBy: 'ts', limitToLast: 12 }, (list) => { feed = list; paintFeed(); }));
    ctx.cleanup(GS.bus.on('settings', paint));
    const timer = setInterval(paintFeed, 30e3);
    ctx.cleanup(() => clearInterval(timer));
  }, { title: 'Bảng xếp hạng' });
})();
