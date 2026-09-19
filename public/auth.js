/**
 * auth.js — CV. Miki Kijang App
 *
 * Sidebar behaviour:
 *   Mobile  < 640px  : hidden; hamburger (☰) in topbar opens overlay drawer
 *   Tablet  640–1023px: icon-only sidebar (60px), no hamburger
 *   Desktop ≥ 1024px : full sidebar (210px)
 *
 * Usage on every page:
 *   <script src="auth.js"></script>
 *   then in DOMContentLoaded:
 *     const SESS = MK_AUTH.require('login.html');          // all roles
 *     const SESS = MK_AUTH.require('login.html', ['packaging','admin']);
 *     if (!SESS) return;
 *     MK_AUTH.initPage('filename.html');
 */

const MK_AUTH = {

  /* ─── Session ─────────────────────────────── */
  get() {
    try {
      const raw = localStorage.getItem('mk_session')
               || sessionStorage.getItem('mk_session');
      if (!raw) return null;
      const s = JSON.parse(raw);
      // Sesi punya masa berlaku (diisi login.html). Lewat batas → anggap logout.
      if (s && s._exp && Date.now() > s._exp) { this._clearSession(); return null; }
      return s;
    } catch (e) { return null; }
  },

  _clearSession() {
    try { localStorage.removeItem('mk_session');   } catch (e) {}
    try { sessionStorage.removeItem('mk_session'); } catch (e) {}
  },

  require(loginPage = 'login.html', allowedRoles = []) {
    const s = this.get();
    if (!s) { window.location.href = loginPage; return null; }
    if (allowedRoles.length && !allowedRoles.includes(s.role)) {
      window.location.href = s.role === 'produksi' ? 'langsiran.html' : 'stats.html';
      return null;
    }
    return s;
  },

  /* Set a demo packaging session if none exists (for preview/testing) */
  ensureDemo() {
    // Demo mode disabled — login required
  },

  logout() {
    this._clearSession();
    try { MK_CACHE.bustAll(); } catch (e) {}
    window.location.href = 'login.html';
  },

  /* ─── Role helpers ─────────────────────────── */
  isAdmin()     { return this.get()?.role === 'admin'; },
  isPackaging() { const r = this.get()?.role; return r === 'packaging' || r === 'admin'; },
  isProduksi()  { const r = this.get()?.role; return r === 'produksi'  || r === 'admin'; },
  canKirim()       { return this.isProduksi(); },
  canTerima()      { return this.isPackaging(); },
  canEditKendala() { return this.isPackaging(); },
  canInputStock()  { return this.isPackaging(); },
  canEditLangsiran(status) {
    // Admin bisa edit semua, produksi hanya yang masih DIKIRIM
    if (this.isAdmin()) return true;
    return this.isProduksi() && status === 'DIKIRIM';
  },
  canDeleteLangsiran() { return this.isAdmin(); },
  canDeleteStock()     { return this.isAdmin(); },
  role()           { return this.get()?.role || ''; },

  /* ─── Sidebar HTML ────────────────────────── */
  _sidebarHTML(activePage) {
    const s   = this.get();
    const role = s?.role || '';
    const isPkg = role === 'packaging' || role === 'admin';
    const ni = (page, icon, label) => {
      const active = activePage === page ? ' active' : '';
      return `<div class="nav-item${active}" onclick="MK_AUTH._go('${page}')"><span class="nav-icon">${icon}</span><span class="nav-label-text"> ${label}</span></div>`;
    };
    let html = `
      <div class="sidebar-logo">
        <div class="brand">CV. Miki Kijang</div>
        <div class="sub">Sales &amp; Produksi</div>
      </div>
      ${this._pillHTML()}`;
    if (isPkg) html += `<div class="nav-section">
        <div class="nav-label">Transaksi</div>
        ${ni('input-penjualan.html','＋','Input Penjualan')}
        ${ni('data-penjualan.html','📋','Data Penjualan')}
      </div>`;
    html += `<div class="nav-section">
        <div class="nav-label">Pabrik</div>
        ${ni('langsiran.html','🚚','Langsiran')}
        ${isPkg ? ni('stock.html','📦','Stock') : ''}
        ${isPkg ? ni('ringkasan.html','📊','Ringkasan') : ''}
      </div>`;
    if (isPkg) html += `<div class="nav-section">
        <div class="nav-label">Tagihan</div>
        ${ni('tagihan.html','📄','Tagihan &amp; Bayar')}
      </div>
      <div class="nav-section">
        <div class="nav-label">Laporan</div>
        ${ni('stats.html','📈','Stats Penjualan')}
      </div>
      <div class="nav-section">
        <div class="nav-label">Master Data</div>
        ${ni('pelanggan.html','👥','Pelanggan')}
        ${ni('produk.html','🏷️','Produk')}
      </div>`;
    const _env = (typeof MK_CONFIG !== 'undefined' && MK_CONFIG.ENV_LABEL)
      ? `<div id="d-env-label" style="font-family:'DM Mono',monospace;font-size:10px;font-weight:700;color:#C4501A;letter-spacing:.08em;margin-bottom:6px;">${MK_CONFIG.ENV_LABEL}</div>`
      : '';
    html += `<div class="sidebar-footer">${_env}<div class="sidebar-date" id="d-sidebar-date"></div></div>`;
    return html;
  },

  _pillHTML() {
    const s = this.get();
    if (!s) return '';
    const roleLabel  = { admin:'⚡ Admin', packaging:'📦 Packaging', produksi:'🏭 Produksi' };
    const roleColors = { admin:{bg:'#F0EFFE',clr:'#534AB7'}, packaging:{bg:'#EDF6F1',clr:'#1A6B45'}, produksi:{bg:'#E6F1FB',clr:'#185FA5'} };
    const c   = roleColors[s.role] || roleColors.admin;
    const ini = s.inisial || s.nama.slice(0,2);
    return `<div class="sidebar-user">
      <div class="user-pill" onclick="MK_AUTH.logout()" title="Logout">
        <div class="user-av" style="background:${c.bg};color:${c.clr};">${ini}</div>
        <div class="user-info">
          <div class="user-name">${s.nama}</div>
          <div class="user-role">${roleLabel[s.role]||s.role}</div>
        </div>
        <div class="user-logout">⏏</div>
      </div>
    </div>`;
  },

  /* Avatar for topbar on mobile (tap → logout) */
  _avatarHTML() {
    const s = this.get();
    if (!s) return '';
    const c = {admin:{bg:'#F0EFFE',clr:'#534AB7'},packaging:{bg:'#EDF6F1',clr:'#1A6B45'},produksi:{bg:'#E6F1FB',clr:'#185FA5'}};
    const col = c[s.role]||c.admin;
    const ini = s.inisial||s.nama.slice(0,2);
    return `<div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;cursor:pointer;background:${col.bg};color:${col.clr};" onclick="MK_AUTH.logout()" title="Logout">${ini}</div>`;
  },

  _go(p) { window.location.href = p; },

  /* ─── Inject global layout CSS ──────────────
   * Called once per page. Provides:
   *   - sidebar behaviour across 3 breakpoints
   *   - hamburger button
   *   - overlay backdrop
   *   - removes bottom-nav
   ───────────────────────────────────────────── */
  _injectCSS() {
    if (document.getElementById('mk-auth-css')) return;
    const css = `
/* ════ MK AUTH LAYOUT ════ */
/* ── Fixed topbar content offset on mobile ── */
@media(max-width:639px){
  .content,.d-content,.page,.m-main{
    padding-top:calc(var(--header-h,52px) + 12px) !important;
  }
  /* Exception: pages that use padding within a specific wrapping div */
  .d-content.no-fix{padding-top:12px!important;}
}
/* ── Topbar title size on small screens ── */
@media(max-width:399px){
  .topbar-title{font-size:13px!important;}
}
/* ── Filter rows on tablet ── */
@media(min-width:640px) and (max-width:1023px){
  .filter-card,.filter-row{flex-wrap:wrap;}
}
/* ── Cards: reduce padding on small screens ── */
@media(max-width:639px){
  .card-body,.card-hd{padding-left:14px!important;padding-right:14px!important;}
  .card-header{padding:10px 14px!important;}
}
/* ── Topbar: wrap if needed ── */
.topbar{flex-wrap:nowrap;overflow:hidden;}
.topbar-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;}

:root{--sb-full:210px;--sb-icon:60px;--header-h:52px;}

/* hide legacy bottom-nav + standalone mobile header */
.bottom-nav{display:none!important;}
.m-header{display:none!important;}
.mobile-header{display:none!important;}

/* ── App shell ── */
.app{display:flex;min-height:100vh;}

/* ── Sidebar ── */
.sidebar{
  background:#1A1714;
  display:flex;flex-direction:column;
  position:fixed;top:0;left:0;bottom:0;z-index:100;
  width:var(--sb-full);
  transition:transform .25s ease,width .2s;
  overflow:hidden;overflow-y:auto;
}

/* Desktop ≥ 1024px: full */
@media(min-width:1024px){
  .sidebar{transform:translateX(0);}
  .main{margin-left:var(--sb-full);}
  .mk-hamburger{display:none!important;}
  .mk-overlay{display:none!important;}
}

/* Tablet 640–1023px: icon-only */
@media(min-width:640px) and (max-width:1023px){
  .sidebar{width:var(--sb-icon);transform:translateX(0);}
  .sidebar .brand,.sidebar .sub,.sidebar .nav-label,
  .sidebar .nav-label-text,.sidebar .sidebar-footer,
  .sidebar .user-info,.sidebar .user-logout,.sidebar .user-name,
  .sidebar .user-role,.sidebar-user .user-pill .user-info{display:none;}
  .sidebar .nav-item{justify-content:center;padding:11px 0;}
  .sidebar .nav-icon{width:auto;font-size:18px;}
  .sidebar .sidebar-logo{padding:14px 0;display:flex;justify-content:center;align-items:center;border-bottom:1px solid rgba(255,255,255,.08);}
  .sidebar .sidebar-logo::before{content:'MK';font-family:'DM Mono',monospace;font-size:12px;font-weight:700;color:rgba(255,255,255,.7);}
  .sidebar .brand,.sidebar .sub{display:none;}
  .sidebar .sidebar-user{padding:8px 0;display:flex;justify-content:center;}
  .sidebar .user-pill{background:transparent;border:none;padding:0;justify-content:center;}
  .sidebar .user-av{width:30px;height:30px;font-size:11px;}
  .main{margin-left:var(--sb-icon);}
  .mk-hamburger{display:none!important;}
  .mk-overlay{display:none!important;}
}

/* Mobile < 640px: hidden drawer */
@media(max-width:639px){
  .sidebar{width:var(--sb-full);transform:translateX(-100%);}
  .sidebar.open{transform:translateX(0);box-shadow:4px 0 24px rgba(0,0,0,.3);}
  .main{margin-left:0;}
  .mk-hamburger{display:flex!important;}
}

/* ── Main ── */
.main{flex:1;display:flex;flex-direction:column;min-height:100vh;}

/* ── Topbar ── */
.topbar{
  background:#FFF;border-bottom:1px solid #D9D4CC;
  padding:0 24px;height:var(--header-h);
  display:flex;align-items:center;gap:12px;
  position:sticky;top:0;z-index:50;
}
@media(max-width:639px){
  .topbar{position:fixed;left:0;right:0;top:0;padding:0 14px;}
  .main>.content,.main>[class*="content"],.d-content{padding-top:calc(var(--header-h) + 12px)!important;}
}

/* ── Hamburger ── */
.mk-hamburger{
  display:none;
  width:32px;height:32px;
  align-items:center;justify-content:center;
  border:1px solid #D9D4CC;border-radius:6px;
  cursor:pointer;font-size:16px;
  background:#FFF;flex-shrink:0;
}

/* ── Overlay backdrop ── */
.mk-overlay{
  display:none;position:fixed;inset:0;
  background:rgba(0,0,0,.4);z-index:99;
}
@media(max-width:639px){
  .mk-overlay.open{display:block;}
}

/* ── Sidebar internals ── */
.sidebar-logo{padding:0 20px 22px;border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:10px;}
.brand{font-family:'DM Mono',monospace;font-size:13px;font-weight:500;color:rgba(255,255,255,.9);letter-spacing:.05em;text-transform:uppercase;}
.sub{font-size:10px;color:rgba(255,255,255,.3);margin-top:2px;font-family:'DM Mono',monospace;}
.sidebar-user{padding:0 12px 14px;}
.user-pill{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:8px 10px;cursor:pointer;}
.user-av{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;}
.user-info{flex:1;min-width:0;}
.user-name{font-size:12px;font-weight:600;color:rgba(255,255,255,.9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.user-role{font-size:10px;color:rgba(255,255,255,.35);font-family:'DM Mono',monospace;}
.user-logout{font-size:14px;color:rgba(255,255,255,.3);flex-shrink:0;}
.nav-section{padding:0 10px;margin-bottom:2px;}
.nav-label{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.22);padding:10px 8px 5px;font-family:'DM Mono',monospace;}
.nav-item{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:6px;color:rgba(255,255,255,.45);font-size:13px;cursor:pointer;transition:all .15s;}
.nav-item:hover{background:rgba(255,255,255,.07);color:rgba(255,255,255,.8);}
.nav-item.active{background:#C4501A;color:#fff;font-weight:500;}
.nav-icon{font-size:14px;width:16px;text-align:center;flex-shrink:0;}
.sidebar-footer{margin-top:auto;padding:14px 20px 0;border-top:1px solid rgba(255,255,255,.07);}
.sidebar-date{font-family:'DM Mono',monospace;font-size:10px;color:rgba(255,255,255,.25);line-height:1.7;}

/* ── Topbar right user info ── */
.topbar-user{font-size:12px;color:#9E9891;font-family:'DM Mono',monospace;margin-left:auto;}
.topbar-title{font-size:14px;font-weight:600;}

/* ── Content padding ── */
.d-content{padding:22px 26px 60px;}
@media(max-width:639px){.d-content{padding:calc(var(--header-h)+14px) 14px 40px;}}
@media(min-width:640px) and (max-width:1023px){.d-content{padding:18px 20px 50px;}}
`;
    const style = document.createElement('style');
    style.id = 'mk-auth-css';
    style.textContent = css;
    document.head.appendChild(style);
  },

  /* ─── initPage: main entry point ─────────────
   * Call after require() on every page.
   ───────────────────────────────────────────── */
  initPage(activePage) {
    this.ensureDemo(); // allow preview without login
    this._injectCSS();

    /* 1. Fill sidebar */
    const sb = document.getElementById('d-sidebar');
    if (sb) sb.innerHTML = this._sidebarHTML(activePage);

    /* 2. Fill user pill placeholder (legacy) */
    const pill = document.getElementById('d-user-pill');
    if (pill) pill.innerHTML = this._pillHTML();

    /* 3. Topbar user text */
    const tu = document.getElementById('d-topbar-user');
    if (tu) {
      const s = this.get();
      const rl = {admin:'⚡ Admin',packaging:'📦 Packaging',produksi:'🏭 Produksi'};
      tu.textContent = s ? s.nama + ' · ' + (rl[s.role]||s.role) : '';
    }

    /* 4. Inject hamburger button + overlay if not present */
    if (!document.getElementById('mk-hamburger')) {
      // Overlay backdrop
      const ov = document.createElement('div');
      ov.className = 'mk-overlay';
      ov.id = 'mk-overlay';
      ov.onclick = () => this._closeSidebar();
      document.body.appendChild(ov);

      // Hamburger — inject into topbar
      const topbar = document.querySelector('.topbar');
      if (topbar) {
        const hb = document.createElement('div');
        hb.className = 'mk-hamburger';
        hb.id = 'mk-hamburger';
        hb.textContent = '☰';
        hb.onclick = () => this._toggleSidebar();
        // Insert as first child of topbar
        topbar.insertBefore(hb, topbar.firstChild);
      }
    }

    /* 5. Mobile avatar in topbar (right side) */
    const mav = document.getElementById('m-av');
    if (mav) {
      mav.innerHTML = this._avatarHTML();
      mav.style.marginLeft = 'auto';
    }

    /* 6. Sidebar date */
    const sd = document.getElementById('d-sidebar-date');
    if (sd) {
      const now = new Date();
      sd.innerHTML = now.toLocaleDateString('id-ID',{weekday:'long'})+'<br>'+
        now.toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});
    }

    /* 7. Ensure .app and .main exist; fix layout if old grid pattern */
    this._fixLayout();
  },

  /* Alias for backwards compatibility */
  initSidebar(activePage) { this.initPage(activePage); },

  /* ─── Hamburger toggle ──────────────────── */
  _toggleSidebar() {
    const sb = document.getElementById('d-sidebar');
    const ov = document.getElementById('mk-overlay');
    if (!sb) return;
    const open = sb.classList.toggle('open');
    if (ov) ov.classList.toggle('open', open);
  },
  _closeSidebar() {
    document.getElementById('d-sidebar')?.classList.remove('open');
    document.getElementById('mk-overlay')?.classList.remove('open');
  },

  /* ─── Fix old layout patterns ──────────────
   * Converts old grid-based .app to flex pattern
   * and ensures .main exists.
   ───────────────────────────────────────────── */
  _fixLayout() {
    const app = document.querySelector('.app');
    if (!app) return;
    // Override old grid styles inline
    app.style.cssText = 'display:flex;min-height:100vh;';

    // If sidebar is inside .app as first child, move to body
    const sb = document.getElementById('d-sidebar');
    if (sb && sb.parentElement === app) {
      document.body.insertBefore(sb, app);
    }

    // Ensure main has class "main"
    const main = app.querySelector('.main, main');
    if (main && !main.classList.contains('main')) {
      main.classList.add('main');
    }
  },

  /* Legacy renderPill / renderMobileAvatar for compat */
  renderPill()         { return this._pillHTML(); },
  renderMobileAvatar() { return this._avatarHTML(); },
};

/* ─────────────────────────────────────────────────────────────
   MK_CACHE — sessionStorage cache untuk GAS fetch
   Otomatis expired, bust setelah write operation.

   Usage:
     const data = await MK_CACHE.fetch('getPelanggan', GAS_URL);
     MK_CACHE.bust('getPelanggan');   // setelah save/update/delete
     MK_CACHE.bustAll();              // setelah logout
   ───────────────────────────────────────────────────────────── */
const MK_CACHE = {
  /* TTL per action dalam milidetik */
  TTL: {
    getPelanggan:      300000,  // 5 menit  — master data
    getProduk:         300000,  // 5 menit  — master data
    getAllNotas:        180000,  // 3 menit — payload terberat; 30 detik dulu
                                //           membuat hampir tiap buka halaman
                                //           mengambil ulang ratusan KB
    getAllNotasLite:    180000,  // 3 menit — versi tanpa rincian barang
    getTodayNotas:      20000,  // 20 detik — berubah aktif
    getTagihan:         30000,  // 30 detik
    getKredit:          30000,  // 30 detik
    getLangsiran:       20000,  // 20 detik
    getStock:           30000,  // 30 detik
    getNotaBelumTagih:  20000,  // 20 detik
  },

  _key(action) { return 'mkc_' + action; },

  get(action) {
    try {
      const raw = sessionStorage.getItem(this._key(action));
      if (!raw) return null;
      const { data, ts, ttl } = JSON.parse(raw);
      if (Date.now() - ts > ttl) {
        sessionStorage.removeItem(this._key(action));
        return null;
      }
      return data;
    } catch(e) { return null; }
  },

  set(action, data) {
    try {
      const ttl = this.TTL[action] || 120000;
      sessionStorage.setItem(this._key(action), JSON.stringify({
        data, ts: Date.now(), ttl
      }));
    } catch(e) {}
  },

  bust(action) {
    try { sessionStorage.removeItem(this._key(action)); } catch(e) {}
  },

  bustAll() {
    try {
      Object.keys(sessionStorage)
        .filter(k => k.startsWith('mkc_'))
        .forEach(k => sessionStorage.removeItem(k));
    } catch(e) {}
  },

  /* Bust hanya data transaksional (bukan master data) */
  bustTransactional() {
    const transactional = ['getAllNotas','getTodayNotas','getTagihan','getKredit',
                           'getLangsiran','getStock','getNotaBelumTagih'];
    transactional.forEach(a => this.bust(a));
  },

  /* Fetch dengan cache — drop-in replacement untuk fetch+json */
  async fetch(action, gasUrl) {
    const cached = this.get(action);
    if (cached) return cached;
    const res  = await window.fetch(`${gasUrl}?action=${action}`);
    const data = await res.json();
    if (data.success) this.set(action, data);
    return data;
  },
};

/* Auto-bust transactional cache saat user kembali ke tab/window */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    MK_CACHE.bustTransactional();
  }
});

/* ─────────────────────────────────────────────────────────────
   MK_LOADER — Global loading overlay
   Pakai di setiap halaman saat fetch GAS.

   Usage:
     MK_LOADER.show();
     await fetchData();
     MK_LOADER.hide();
   ───────────────────────────────────────────────────────────── */
const MK_LOADER = (() => {
  let el = null;

  function _ensure() {
    if (el) return;
    // Inject CSS once
    if (!document.getElementById('mk-loader-css')) {
      const s = document.createElement('style');
      s.id = 'mk-loader-css';
      s.textContent = `
        #mk-loader{
          position:fixed;inset:0;background:rgba(245,242,237,.82);
          backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);
          z-index:9999;display:flex;flex-direction:column;
          align-items:center;justify-content:center;gap:14px;
          opacity:0;pointer-events:none;transition:opacity .2s;
        }
        #mk-loader.visible{opacity:1;pointer-events:all;}
        .mk-spinner{
          width:36px;height:36px;border-radius:50%;
          border:3px solid #D9D4CC;
          border-top-color:#C4501A;
          animation:mk-spin .7s linear infinite;
        }
        @keyframes mk-spin{to{transform:rotate(360deg);}}
        .mk-loader-txt{
          font-family:'DM Mono',monospace;font-size:12px;
          color:#6B6560;letter-spacing:.05em;
        }
      `;
      document.head.appendChild(s);
    }
    el = document.createElement('div');
    el.id = 'mk-loader';
    el.innerHTML = '<div class="mk-spinner"></div><div class="mk-loader-txt">Memuat data...</div>';
    document.body.appendChild(el);
  }

  return {
    show(msg = 'Memuat data...') {
      _ensure();
      el.querySelector('.mk-loader-txt').textContent = msg;
      // Small delay so instant cache hits never flash
      clearTimeout(el._showTimer);
      clearTimeout(el._safetyTimer);
      el._showTimer = setTimeout(() => el.classList.add('visible'), 80);
      // Safety: auto-hide after 15s no matter what
      el._safetyTimer = setTimeout(() => el.classList.remove('visible'), 15000);
    },
    hide() {
      if (!el) return;
      clearTimeout(el._showTimer);
      clearTimeout(el._safetyTimer);
      el.classList.remove('visible');
    },
  };
})();
