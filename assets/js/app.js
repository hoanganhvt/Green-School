/* Khởi động ứng dụng */
(function () {
  const GS = window.GS;
  const U = GS.util;

  const start = async () => {
    try {
      await GS.boot();
    } catch (e) {
      console.error(e);
      U.$('#app').innerHTML = `<div class="boot-fail"><h1>Không khởi động được</h1><p>${U.esc(e.message)}</p></div>`;
      return;
    }
    document.documentElement.dataset.mode = GS.db.mode;

    let lastUid = GS.state.uid, lastAdmin = GS.state.isAdmin;
    GS.bus.on('auth', () => {
      if (GS.state.uid !== lastUid || GS.state.isAdmin !== lastAdmin) {
        const loggedOut = lastUid && !GS.state.uid;
        lastUid = GS.state.uid; lastAdmin = GS.state.isAdmin;
        const { path } = GS.currentPath();
        if (path === '/login' || path === '/register' || path === '/setup') return; // trang tự điều hướng
        if (loggedOut && GS.layout.current === 'admin') { GS.go('/'); return; }
        GS.render();
      } else GS.layout.refreshChrome();
    });
    GS.bus.on('settings', () => {
      GS.layout.refreshChrome();
      const t = document.title.split(' | ');
      document.title = (t.length > 1 ? t[0] + ' | ' : '') + GS.state.settings.appName;
    });
    window.addEventListener('hashchange', GS.render);

    /* Chế độ demo: giả lập tín hiệu "còn sống" của các thùng mẫu */
    if (GS.db.mode === 'demo') {
      const beat = () => {
        const bins = GS.db.read('bins') || {};
        const upd = {};
        Object.values(bins).forEach((b) => { if (b.demo) upd[`bins/${b.id}/lastSeen`] = Date.now(); });
        if (Object.keys(upd).length) GS.db.update(upd);
      };
      beat(); setInterval(beat, 30e3);
    }

    await GS.render();
    document.body.classList.add('is-ready');
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
