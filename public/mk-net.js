/* ============================================================
   mk-net.js — Lapisan jaringan tahan-lemot untuk BUKU MK
   ------------------------------------------------------------
   Pasang SETELAH auth.js di SEMUA halaman:

     <script src="auth.js"></script>
     <script src="mk-net.js"></script>

   Tidak ada perubahan kode halaman yang diperlukan.
   File ini menambal MK_CACHE di tempat (in-place patch).

   Yang berubah:
   1. Cache pindah dari sessionStorage → localStorage
      (bertahan setelah tab ditutup / HP mengunci layar)
   2. Stale-while-revalidate: data lama tampil INSTAN,
      data baru diambil di latar belakang
   3. Timeout + retry backoff untuk semua GET
   4. Antrian tulis offline (nota tidak hilang saat sinyal putus)
   5. Banner status koneksi
   ============================================================ */
(function () {
  'use strict';

  if (typeof MK_CACHE === 'undefined') {
    console.error('[mk-net] auth.js harus dimuat lebih dulu.');
    return;
  }

  /* ─── Konfigurasi ─────────────────────────────────────── */
  const NS        = 'mkc2_';        // prefix cache
  const QKEY      = 'mk_wq';        // antrian tulis
  const HARD_TTL  = 24 * 3600e3;    // data basi masih dipakai s/d 24 jam
  const TIMEOUT   = 12000;          // 12 dtk per percobaan
  const RETRIES   = 2;              // total 3 percobaan
  const RETRY_WRITES = true;        // aman: Code.gs v2 sudah punya dedupe clientRef

  /* ─── Storage aman (localStorage → sessionStorage → memori) ── */
  const mem = {};
  const S = (() => {
    try {
      localStorage.setItem('__t', '1');
      localStorage.removeItem('__t');
      return localStorage;
    } catch (e) {
      try {
        sessionStorage.setItem('__t', '1');
        sessionStorage.removeItem('__t');
        return sessionStorage;
      } catch (e2) {
        return {
          getItem: k => (k in mem ? mem[k] : null),
          setItem: (k, v) => { mem[k] = v; },
          removeItem: k => { delete mem[k]; },
        };
      }
    }
  })();

  const key = a => NS + a;

  function readRaw(action) {
    try {
      const raw = S.getItem(key(action));
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || typeof o.ts !== 'number') return null;
      return o;                       // { data, ts, dirty, fp }
    } catch (e) { return null; }
  }

  /** Tulis satu rekaman utuh; kalau kuota penuh, buang yang paling tua. */
  function store(action, record) {
    try {
      S.setItem(key(action), record);
      return;
    } catch (e) { /* kemungkinan kuota penuh */ }

    try {
      const keys = Object.keys(S).filter(k => k.indexOf(NS) === 0 && k !== key(action));
      keys.sort((a, b) => {
        const ta = (JSON.parse(S.getItem(a) || '{}').ts) || 0;
        const tb = (JSON.parse(S.getItem(b) || '{}').ts) || 0;
        return ta - tb;
      });
      if (keys.length) S.removeItem(keys[0]);
      S.setItem(key(action), record);
    } catch (e2) { /* menyerah dengan tenang */ }
  }

  function writeRaw(action, data, dirty) {
    store(action, JSON.stringify({ data, ts: Date.now(), dirty: !!dirty }));
  }

  /** Versi hemat: payload sudah berupa teks JSON, jadi tidak di-stringify
   *  ulang. Dipakai absorb() pada jalur panas (getAllNotas dsb).          */
  function writeRawText(action, dataTxt, fp, dirty) {
    store(action,
      '{"data":' + dataTxt +
      ',"ts":'   + Date.now() +
      ',"dirty":'+ (dirty ? 'true' : 'false') +
      ',"fp":'   + JSON.stringify(fp) + '}');
  }

  const softTTL = action => MK_CACHE.TTL[action] || 120000;

  /* ─── fetch dengan timeout + retry ────────────────────── */
  async function netGet(url, tries) {
    tries = (tries == null) ? RETRIES : tries;
    let lastErr;
    for (let i = 0; i <= tries; i++) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), TIMEOUT);
      try {
        const res = await window.fetch(url, { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      } catch (e) {
        clearTimeout(t);
        lastErr = e;
        if (i < tries) await new Promise(r => setTimeout(r, 600 * Math.pow(2, i)));
      }
    }
    throw lastErr;
  }

  /* ─── Sidik jari murah untuk mendeteksi perubahan ──────
     Dulu tiap revalidate menjalankan JSON.stringify TIGA kali pada
     payload yang sama (dua untuk membandingkan, satu untuk menyimpan).
     Pada getAllNotas yang ratusan KB, itu terasa sebagai macet
     sesaat di HP. Sekarang: satu stringify, lalu hash 32-bit.      */
  function fingerprint(txt) {
    var h = 5381;
    for (var i = 0; i < txt.length; i++) h = ((h * 33) ^ txt.charCodeAt(i)) >>> 0;
    return txt.length + ':' + h;
  }

  /* ─── Event bus untuk refresh latar belakang ──────────── */
  const listeners = [];
  function emitRefresh(action, data, hadPrev) {
    listeners.forEach(fn => { try { fn(action, data); } catch (e) {} });
    window.dispatchEvent(new CustomEvent('mk:refresh', { detail: { action, data } }));
    // Halaman yang mendaftarkan onRefresh sudah merender sendiri. Sisanya
    // tidak, jadi tandai di bilah status bahwa ada isi baru yang menunggu —
    // tapi hanya kalau memang ada data lama yang sedang tampil.
    if (!listeners.length && hadPrev) { hasNew = true; renderBar(); }
  }

  /* ─── Penggabungan permintaan (batching) ───────────────────
     Inti perbaikan kecepatan v2.1.

     Tiap panggilan ke /exec adalah satu eksekusi Apps Script
     tersendiri — dengan cold start dan pembukaan spreadsheet
     masing-masing. tagihan.html memanggil Promise.all dengan LIMA
     action sekaligus, jadi dulu itu lima eksekusi berurutan.

     Karena Promise.all memanggil semuanya dalam satu tick JS, kita
     cukup menampung permintaan sesaat lalu mengirimkannya sebagai
     SATU permintaan ?action=batch. Halaman tidak perlu diubah
     sedikit pun — mereka tetap memanggil MK_CACHE.fetch seperti biasa.

     Kalau backend belum di-deploy ulang (belum kenal action=batch),
     lapisan ini otomatis mundur ke permintaan satuan. Jadi frontend
     baru tetap aman dijalankan di atas Code.gs lama.               */
  const inflight = {};        // action -> Promise (dedupe permintaan paralel)
  const waiting  = {};        // action -> [{resolve, reject}]
  let   batchTimer = null;
  let   batchUrl   = null;

  /** Simpan hasil ke cache + beri tahu halaman kalau isinya berubah. */
  function absorb(action, d) {
    if (!d || !d.success) return;
    const txt  = JSON.stringify(d);          // satu-satunya stringify
    const fp   = fingerprint(txt);
    const prev = readRaw(action);
    const changed = !prev || prev.fp !== fp;

    writeRawText(action, txt, fp, false);
    // hadPrev menandai apakah layar sedang menampilkan data LAMA.
    // Kalau sebelumnya belum ada cache sama sekali, pemanggil sedang
    // menunggu jawaban ini dan akan langsung merendernya — jadi tidak
    // ada "data baru" yang tertinggal, dan bilah status tidak boleh
    // mengatakan ada.
    if (changed) emitRefresh(action, d, !!prev);
  }

  function settle(action, data, err) {
    const w = waiting[action] || [];
    delete waiting[action];
    delete inflight[action];

    busyCount = Math.max(0, busyCount - 1);
    if (!err) lastSync = Date.now();
    renderBar();

    if (err) w.forEach(x => x.reject(err));
    else     w.forEach(x => x.resolve(data));
  }

  /** Ambil satu action sendirian (fallback & kasus permintaan tunggal). */
  async function fetchSingle(action, url) {
    try {
      let d = await netGet(`${url}?action=${action}`);
      // Backend lama menjawab action tak dikenal dengan pesan status biasa
      // (tanpa field success). Kalau ada padanan lama, pakai itu.
      if ((!d || !d.success) && ACTION_FALLBACK[action]) {
        try {
          const alt = await netGet(`${url}?action=${ACTION_FALLBACK[action]}`);
          if (alt && alt.success) d = alt;
        } catch (e) {}
      }
      setNetState(true);
      absorb(action, d);
      settle(action, d);
      return d;
    } catch (e) {
      setNetState(false);
      settle(action, null, e);
      throw e;
    }
  }

  /* Padanan lama untuk action yang baru ada di Code.gs versi terbaru.
     Kalau backend belum di-deploy ulang, action baru tidak dikenal dan
     DIBUANG diam-diam dari hasil batch. Tanpa jaring ini, satu action
     yang hilang menolak Promise-nya, Promise.all di halaman ikut gagal,
     dan SELURUH halaman kosong — bukan hanya bagian yang hilang.

     getAllNotasLite hanyalah getAllNotas tanpa rincian barang, jadi yang
     lama selalu bisa dipakai sebagai gantinya. */
  const ACTION_FALLBACK = { getAllNotasLite: 'getAllNotas' };

  async function resolveMissing(action, url) {
    const alt = ACTION_FALLBACK[action];
    if (alt) {
      try {
        const d = await netGet(`${url}?action=${alt}`);
        if (d && d.success) { setNetState(true); absorb(action, d); settle(action, d); return; }
      } catch (e) { /* jatuh ke percobaan satuan di bawah */ }
    }
    await fetchSingle(action, url).catch(() => {});
  }

  async function flushBatch() {
    batchTimer = null;
    const actions = Object.keys(waiting);
    const url     = batchUrl;
    if (!actions.length || !url) return;

    // Cuma satu → tidak ada gunanya dibungkus batch.
    if (actions.length === 1) {
      await fetchSingle(actions[0], url).catch(() => {});
      return;
    }

    let res = null;
    try {
      res = await netGet(`${url}?action=batch&a=${encodeURIComponent(actions.join(','))}`);
    } catch (e) {
      // Batch gagal (jaringan / URL terlalu panjang) → coba satuan.
      setNetState(false);
      await Promise.all(actions.map(a => fetchSingle(a, url).catch(() => {})));
      return;
    }

    // Backend lama tidak mengenal action=batch dan membalas pesan status
    // biasa. Kenali itu, lalu mundur ke permintaan satuan.
    if (!res || !res.batch || !res.results) {
      await Promise.all(actions.map(a => fetchSingle(a, url).catch(() => {})));
      return;
    }

    setNetState(true);
    const missing = [];
    actions.forEach(a => {
      const d = res.results[a];
      if (d === undefined) { missing.push(a); return; }   // backend tidak kenal action ini
      absorb(a, d);
      settle(a, d);
    });
    if (missing.length) await Promise.all(missing.map(a => resolveMissing(a, url)));
  }

  /** Minta data segar dari server. Otomatis digabung dengan permintaan
   *  lain yang terjadi pada tick yang sama. */
  function revalidate(action, gasUrl) {
    if (inflight[action]) return inflight[action];

    const p = new Promise((resolve, reject) => {
      (waiting[action] = waiting[action] || []).push({ resolve, reject });
    });
    inflight[action] = p;
    p.catch(() => {});          // penolakan ditangani pemanggil; jangan bising di console

    busyCount++;                // dipakai bilah status di bawah layar
    renderBar();

    batchUrl = gasUrl || batchUrl;
    if (!batchTimer) batchTimer = setTimeout(flushBatch, 0);
    return p;
  }

  /* ─── Tambal MK_CACHE ─────────────────────────────────── */

  // get(): tetap semantik lama — hanya kembalikan data yang masih segar
  MK_CACHE.get = function (action) {
    const o = readRaw(action);
    if (!o || o.dirty) return null;
    if (Date.now() - o.ts > softTTL(action)) return null;
    return o.data;
  };

  MK_CACHE.set = function (action, data) { writeRaw(action, data, false); };

  // bust(): dipakai setelah TULIS → tandai wajib-revalidasi,
  // TAPI jangan hapus datanya (masih berguna kalau jaringan mati)
  MK_CACHE.bust = function (action) {
    const o = readRaw(action);
    // fp dipertahankan: kalau server ternyata mengembalikan isi yang sama,
    // halaman tidak perlu dikejutkan pil "data baru tersedia".
    if (o) store(action, JSON.stringify({ data: o.data, ts: o.ts, dirty: true, fp: o.fp }));
    else   { try { S.removeItem(key(action)); } catch (e) {} }
  };

  MK_CACHE.bustAll = function () {
    try {
      Object.keys(S).filter(k => k.indexOf(NS) === 0).forEach(k => S.removeItem(k));
    } catch (e) {}
  };

  // bustTransactional(): dipanggil auth.js tiap kali tab kembali aktif.
  // Dulu ini MENGHAPUS cache → tiap balik ke tab = fetch penuh (lemot di HP).
  // Sekarang cuma "menuakan" cache → data lama tampil instan, refresh di belakang.
  MK_CACHE.bustTransactional = function () {
    ['getAllNotas', 'getAllNotasLite', 'getTodayNotas', 'getTagihan', 'getKredit',
     'getLangsiran', 'getStock', 'getNotaBelumTagih'].forEach(a => {
      const o = readRaw(a);
      if (!o) return;
      // Mundurkan ts tepat melewati soft-TTL: data dianggap "basi" sehingga
      // dipicu refresh latar belakang, TAPI datanya tetap dipakai untuk render instan.
      const ts = Math.max(Date.now() - softTTL(a) - 1000, Date.now() - HARD_TTL + 60000);
      try { S.setItem(key(a), JSON.stringify({ data: o.data, ts, dirty: false, fp: o.fp })); }
      catch (e) {}
    });
  };

  // fetch(): inti stale-while-revalidate
  MK_CACHE.fetch = async function (action, gasUrl) {
    const o   = readRaw(action);
    const now = Date.now();

    // 1. Cache segar → langsung pakai
    if (o && !o.dirty && (now - o.ts) <= softTTL(action)) return o.data;

    // 2. Ada cache tapi kotor (habis nulis) → wajib tunggu server,
    //    kalau gagal baru mundur ke cache lama
    if (o && o.dirty) {
      try { return await revalidate(action, gasUrl); }
      catch (e) {
        if (now - o.ts <= HARD_TTL) { flagStale(); return o.data; }
        throw e;
      }
    }

    // 3. Ada cache basi (kadaluarsa waktu) → tampilkan SEKARANG,
    //    ambil versi baru di latar belakang
    if (o && (now - o.ts) <= HARD_TTL) {
      revalidate(action, gasUrl).catch(() => {});
      return o.data;
    }

    // 4. Tidak ada cache sama sekali → harus tunggu jaringan
    return await revalidate(action, gasUrl);
  };

  /* ─── Antrian tulis offline ───────────────────────────── */
  function qRead()  { try { return JSON.parse(S.getItem(QKEY) || '[]'); } catch (e) { return []; } }
  function qWrite(a){ try { S.setItem(QKEY, JSON.stringify(a)); } catch (e) {} }

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'r' + Date.now() + Math.random().toString(36).slice(2));

  async function postOnce(url, payload) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const res = await window.fetch(url, {
        method: 'POST',
        body: JSON.stringify(payload),
        signal: ctl.signal,
      });
      clearTimeout(t);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  const MK_NET = {
    /**
     * post(url, payload, opts)
     *  opts.queue  = true  → kalau gagal, simpan ke antrian & kirim ulang nanti
     *  opts.retries        → jumlah percobaan ulang (default: RETRY_WRITES ? 2 : 0)
     * Selalu menyisipkan clientRef untuk dedupe di sisi GAS.
     */
    async post(url, payload, opts) {
      opts = opts || {};
      if (!payload.clientRef) payload.clientRef = uuid();
      const tries = opts.retries != null ? opts.retries : (RETRY_WRITES ? 2 : 0);

      let lastErr;
      for (let i = 0; i <= tries; i++) {
        try {
          const d = await postOnce(url, payload);
          setNetState(true);
          return d;
        } catch (e) {
          lastErr = e;
          if (i < tries) await new Promise(r => setTimeout(r, 800 * Math.pow(2, i)));
        }
      }
      setNetState(false);
      if (opts.queue) {
        const q = qRead();
        q.push({ url, payload, at: Date.now() });
        qWrite(q);
        renderBanner();
        return { success: false, queued: true, error: 'Offline — disimpan di antrian' };
      }
      throw lastErr;
    },

    queueSize() { return qRead().length; },

    async flush() {
      const q = qRead();
      if (!q.length) return;
      const sisa = [];
      for (const job of q) {
        try {
          const d = await postOnce(job.url, job.payload);
          if (!d || !d.success) sisa.push(job);
        } catch (e) { sisa.push(job); }
      }
      qWrite(sisa);
      renderBanner();
      if (sisa.length < q.length) {
        MK_CACHE.bustAll();
        toast('✓ ' + (q.length - sisa.length) + ' perubahan tersimpan ke server');
      }
    },

    /** Daftarkan callback saat data latar belakang berubah.
     *  Contoh: MK_NET.onRefresh((action) => { if(action==='getProduk') render(); }); */
    onRefresh(fn) { listeners.push(fn); },

    /** Prefetch data untuk halaman berikutnya (dipanggil saat idle). */
    warm(gasUrl, actions) {
      if (!navigator.onLine) return;
      const run = () => actions.forEach(a => {
        const o = readRaw(a);
        if (!o || Date.now() - o.ts > softTTL(a)) revalidate(a, gasUrl).catch(() => {});
      });
      if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 3000 });
      else setTimeout(run, 1500);
    },

    online() { return navigator.onLine !== false; },
  };
  window.MK_NET = MK_NET;

  /* ─── Bilah status (selalu tampil) ─────────────────────────
     Menggantikan dua hal dari versi sebelumnya:

       1. Bilah merah yang HANYA muncul saat offline. Selebihnya
          tidak ada tanda apa pun, jadi saat data sedang diambil
          layar terlihat sama persis dengan saat sudah selesai —
          tidak ada cara tahu apakah masih menunggu.

       2. Pil melayang "Data baru tersedia — ketuk untuk muat
          ulang" yang muncul di tengah bawah, menutupi isi
          halaman, lalu hilang sendiri setelah 12 detik. Kalau
          sedang tidak melihat layar, pesannya terlewat.

     Sekarang: satu baris tipis yang menetap di bawah layar.
     Kiri  — keadaan saat ini (sedang mengambil / sudah terbaru /
             offline / ada perubahan menunggu dikirim).
     Kanan — satu tombol kecil untuk memuat ulang data.

     Baris ini tidak pernah menutupi isi halaman: tingginya
     dikompensasi lewat padding-bottom pada <body>.             */

  let netOk = true, staleShown = false;
  let busyCount = 0;          // berapa action sedang diambil dari server
  let lastSync  = 0;          // kapan terakhir kali data berhasil masuk
  let hasNew    = false;      // server mengirim isi yang berbeda

  function setNetState(ok) { if (netOk !== ok) { netOk = ok; renderBar(); } }
  function flagStale() { staleShown = true; renderBar(); }

  function ensureCSS() {
    if (document.getElementById('mk-net-css')) return;
    const s = document.createElement('style');
    s.id = 'mk-net-css';
    s.textContent = `
    /* Warna keadaan dipegang tiga variabel, lalu dipakai ulang oleh
       latar, garis, titik, dan tombol. Menambah keadaan baru cukup
       mengganti ketiganya — tidak perlu menulis ulang setiap bagian.

         --s    warna utama (teks, titik, isi tombol)
         --sbg  latar bilah
         --sbd  garis atas

       Semua pasangan sudah diperiksa terhadap standar kontras WCAG AA
       (minimal 4.5:1), termasuk teks putih di atas tombol berwarna:
         hijau  5.89:1   kuning 5.47:1   merah 5.49:1
         tombol 6.50:1          5.79:1          6.28:1            */
    #mk-net-bar{
      --s:#1A6B45; --sbg:#EDF6F1; --sbd:#C9E3D6;     /* baik */
      position:fixed; left:0; right:0; bottom:0; z-index:10000;
      display:flex; align-items:center; gap:10px;
      height:34px; padding:0 10px 0 14px;
      padding-bottom:env(safe-area-inset-bottom);
      box-sizing:content-box;
      background:var(--sbg);
      border-top:1px solid var(--sbd);
      color:var(--s);
      font-family:var(--sans,'DM Sans',sans-serif);
      font-size:13px; font-weight:500;
      user-select:none;
      transition:background-color .2s ease, border-color .2s ease, color .2s ease;
    }
    /* sedang mengambil data */
    #mk-net-bar.busy{--s:#8B5C00; --sbg:#FEF8EC; --sbd:#EEDCB0;}
    /* gagal / tidak ada sambungan */
    #mk-net-bar.bad {--s:#B3300F; --sbg:#FDECEC; --sbd:#F2C7C7;}

    #mk-net-dot{
      width:8px; height:8px; border-radius:50%; flex:0 0 auto;
      background:var(--s);
      box-shadow:0 0 0 3px color-mix(in srgb, var(--s) 18%, transparent);
    }
    #mk-net-bar.busy #mk-net-dot{animation:mkPulse 1s ease-in-out infinite;}
    @keyframes mkPulse{0%,100%{opacity:1}50%{opacity:.3}}

    #mk-net-txt{flex:1; min-width:0; white-space:nowrap;
      overflow:hidden; text-overflow:ellipsis;}

    /* Tombol sengaja dibuat mencolok: berisi warna penuh dengan teks
       putih, bukan sekadar garis tepi, supaya jelas ini bisa ditekan. */
    #mk-net-btn{
      flex:0 0 auto; display:inline-flex; align-items:center; gap:6px;
      height:26px; padding:0 12px; border-radius:999px;
      border:none; background:var(--s); color:#fff;
      font-family:inherit; font-size:12.5px; font-weight:600;
      letter-spacing:.01em; cursor:pointer; white-space:nowrap;
      box-shadow:0 1px 2px rgba(26,23,20,.18);
      transition:filter .12s ease, transform .06s ease, box-shadow .12s ease;
    }
    #mk-net-btn:hover{filter:brightness(1.12); box-shadow:0 2px 6px rgba(26,23,20,.22);}
    #mk-net-btn:active{transform:translateY(1px); box-shadow:0 1px 1px rgba(26,23,20,.2);}
    #mk-net-btn:focus-visible{outline:2px solid var(--s); outline-offset:2px;}
    #mk-net-btn:disabled{opacity:.55; cursor:default; box-shadow:none; filter:none;}
    #mk-net-btn .ic{display:inline-block; font-size:13px; line-height:1;}
    #mk-net-bar.busy #mk-net-btn .ic{animation:mkSpin .9s linear infinite;}
    @keyframes mkSpin{to{transform:rotate(360deg)}}

    /* Ada data baru: bilah tetap hijau karena datanya sendiri sehat —
       yang perlu menarik perhatian adalah tombolnya. */
    #mk-net-bar.fresh #mk-net-btn{
      background:var(--accent,#C4501A);
      animation:mkNudge 1.8s ease-in-out infinite;
    }
    @keyframes mkNudge{
      0%,100%{box-shadow:0 1px 2px rgba(26,23,20,.18);}
      50%    {box-shadow:0 0 0 4px rgba(196,80,26,.22);}
    }

    #mk-net-toast{position:fixed;left:50%;transform:translateX(-50%);
      bottom:50px; z-index:10002; background:#1A6B45; color:#fff;
      border-radius:8px; padding:9px 16px;
      font-family:var(--sans,'DM Sans',sans-serif); font-size:13px;
      box-shadow:0 6px 22px rgba(0,0,0,.2); display:none;}
    #mk-net-toast.on{display:block;}

    /* Sejajar dengan sidebar, bukan memotongnya. Lebar sidebar mengikuti
       nilai yang sudah dipakai auth.js: 210px penuh, 60px mode ikon. */
    @media (min-width:1024px){#mk-net-bar{left:var(--sb-full,210px);}}
    @media (min-width:640px) and (max-width:1023px){#mk-net-bar{left:var(--sb-icon,60px);}}

    /* Di layar sempit, label tombol dipendekkan agar keterangan kiri
       tetap terbaca utuh. */
    @media (max-width:420px){
      #mk-net-bar{font-size:12.5px; padding-left:12px;}
      #mk-net-btn{padding:0 10px;}
    }

    @media (prefers-reduced-motion:reduce){
      #mk-net-dot, #mk-net-btn, #mk-net-btn .ic{animation:none!important;}
    }

    /* Baris ini tidak ikut tercetak, dan tidak boleh menutupi isi */
    @media print{#mk-net-bar,#mk-net-toast{display:none!important;}}
    body{padding-bottom:calc(38px + env(safe-area-inset-bottom));}
    `;
    document.head.appendChild(s);
  }

  function el(id, cls) {
    if (!document.body) return null;
    let e = document.getElementById(id);
    if (!e) { e = document.createElement('div'); e.id = id; if (cls) e.className = cls;
              document.body.appendChild(e); }
    return e;
  }

  /** "baru saja" / "3 mnt lalu" / "1 jam lalu" */
  function sinceText(ts) {
    if (!ts) return '';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 45)   return 'baru saja';
    if (s < 3600) return Math.round(s / 60) + ' mnt lalu';
    if (s < 86400) return Math.round(s / 3600) + ' jam lalu';
    return Math.round(s / 86400) + ' hari lalu';
  }

  function buildBar() {
    // Permintaan data bisa berangkat sebelum <body> ada (berkas ini dimuat
    // di <head>). Tanpa penjaga ini, appendChild akan gagal.
    if (!document.body) return null;
    ensureCSS();
    let bar = document.getElementById('mk-net-bar');
    if (bar) return bar;

    bar = document.createElement('div');
    bar.id = 'mk-net-bar';
    bar.innerHTML =
      '<span id="mk-net-dot"></span>' +
      '<span id="mk-net-txt"></span>' +
      '<button id="mk-net-btn" type="button" title="Muat ulang data">' +
        '<span class="ic">↻</span><span id="mk-net-btn-lbl">Muat ulang</span>' +
      '</button>';
    document.body.appendChild(bar);
    document.getElementById('mk-net-btn').addEventListener('click', () => MK_NET.refresh());
    return bar;
  }

  function renderBar() {
    const bar = buildBar();
    if (!bar) return;           // <body> belum ada — akan digambar saat DOM siap
    const txt = document.getElementById('mk-net-txt');
    const btn = document.getElementById('mk-net-btn');
    const lbl = document.getElementById('mk-net-btn-lbl');
    const n   = qRead().length;
    const narrow = window.innerWidth < 420;

    bar.className = '';
    btn.disabled  = false;

    if (busyCount > 0) {
      // KUNING — sedang berjalan
      bar.className = 'busy';
      txt.textContent = 'Mengambil data...';
      btn.disabled = true;
      lbl.textContent = narrow ? '' : 'Memuat';

    } else if (!navigator.onLine) {
      // MERAH — tidak ada jaringan sama sekali
      bar.className = 'bad';
      txt.textContent = n
        ? `Tidak ada sambungan — ${n} perubahan menunggu`
        : 'Tidak ada sambungan — menampilkan data tersimpan';
      lbl.textContent = narrow ? '' : 'Coba lagi';

    } else if (!netOk) {
      // MERAH — ada jaringan, tapi server tidak menjawab.
      // Dibedakan dari kasus di atas supaya jelas mana yang harus
      // diperiksa: sinyal, atau deployment Apps Script-nya.
      bar.className = 'bad';
      txt.textContent = 'Gagal mengambil data dari server';
      lbl.textContent = narrow ? '' : 'Coba lagi';

    } else if (n) {
      // KUNING — perubahan masih dalam perjalanan ke server
      bar.className = 'busy';
      txt.textContent = `Mengirim ${n} perubahan tertunda...`;
      lbl.textContent = narrow ? '' : 'Kirim ulang';

    } else if (hasNew) {
      // HIJAU dengan tombol menyala — datanya sehat, hanya ada versi
      // yang lebih baru yang belum ditampilkan.
      bar.className = 'fresh';
      txt.textContent = 'Ada data baru dari server';
      lbl.textContent = 'Tampilkan';

    } else if (staleShown) {
      bar.className = 'busy';
      txt.textContent = 'Data mungkin belum terbaru';
      lbl.textContent = narrow ? '' : 'Muat ulang';
      clearTimeout(renderBar._t);
      renderBar._t = setTimeout(() => { staleShown = false; renderBar(); }, 5000);

    } else {
      // HIJAU — semuanya beres
      const s = sinceText(lastSync);
      txt.textContent = lastSync ? `Data terbaru${s ? ' · ' + s : ''}` : 'Data tersimpan';
      lbl.textContent = narrow ? '' : 'Muat ulang';
    }
  }

  // "3 mnt lalu" harus ikut bertambah tanpa perlu ada kejadian apa pun
  setInterval(() => { if (!busyCount && !hasNew) renderBar(); }, 30000);

  /**
   * refresh() — buang cache lalu muat ulang halaman.
   *
   * Memuat ulang, bukan sekadar mengambil ulang, karena sebagian besar
   * halaman merender datanya sekali saat dibuka dan tidak mendengarkan
   * pembaruan latar belakang; mengambil data baru tanpa memuat ulang
   * tidak akan mengubah apa pun di layar.
   *
   * Karena memuat ulang berarti isian yang belum disimpan akan hilang,
   * halaman yang sedang diisi akan dikonfirmasi lebih dulu.
   */
  MK_NET.refresh = function () {
    if (hasUnsavedInput() &&
        !window.confirm('Ada isian yang belum disimpan di halaman ini.\n' +
                        'Memuat ulang akan menghapusnya. Lanjutkan?')) return;
    try { MK_CACHE.bustAll(); } catch (e) {}
    location.reload();
  };

  /** Adakah isian terketik yang belum disimpan? */
  function hasUnsavedInput() {
    try {
      const f = document.querySelectorAll('input[type=text], input[type=number], textarea');
      for (const i of f) {
        if (i.offsetParent === null) continue;         // tersembunyi
        if (i.readOnly || i.disabled) continue;
        const v = (i.value || '').trim();
        if (v && v !== (i.defaultValue || '').trim()) return true;
      }
    } catch (e) {}
    return false;
  }

  function toast(msg) {
    ensureCSS();
    const t = el('mk-net-toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'on';
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.className = ''; }, 3500);
  }
  MK_NET.toast = toast;

  // Nama lama dipertahankan: dipanggil dari beberapa tempat lain di berkas ini.
  function renderBanner() { renderBar(); }

  /* ─── Perisai otomatis untuk SEMUA POST ke GAS ──────────
     Halaman-halaman lama memanggil fetch(GAS,{method:'POST'}) langsung.
     Daripada mengedit 13 file, kita bungkus window.fetch dan hanya
     mencegat permintaan yang menuju MK_CONFIG.GAS. Semua panggilan
     tulis otomatis dapat: timeout, percobaan ulang, dan clientRef
     (kunci dedupe supaya kirim-ulang tidak membuat nota ganda).      */
  (function shieldPost() {
    if (typeof MK_CONFIG === 'undefined' || !MK_CONFIG.GAS) return;
    const raw = window.fetch.bind(window);
    const target = String(MK_CONFIG.GAS).split('?')[0];

    window.fetch = function (input, init) {
      const url = (typeof input === 'string') ? input : (input && input.url) || '';
      const isPost = init && init.method && init.method.toUpperCase() === 'POST';

      // Bukan POST ke GAS → lewatkan apa adanya
      if (!isPost || String(url).split('?')[0] !== target || init.signal) {
        return raw(input, init);
      }

      let body = init.body;
      try {
        const o = JSON.parse(body);
        if (!o.clientRef) { o.clientRef = uuid(); body = JSON.stringify(o); }
      } catch (e) { /* body bukan JSON — biarkan */ }

      const attempt = async (n) => {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), TIMEOUT);
        try {
          const res = await raw(url, Object.assign({}, init, { body, signal: ctl.signal }));
          clearTimeout(t);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          setNetState(true);
          return res;
        } catch (e) {
          clearTimeout(t);
          if (RETRY_WRITES && n < 2) {
            await new Promise(r => setTimeout(r, 800 * Math.pow(2, n)));
            return attempt(n + 1);
          }
          setNetState(false);
          throw e;
        }
      };
      return attempt(0);
    };
  })();

  /* ─── Pemanasan otomatis halaman berikutnya ────────────────
     MK_NET.warm() sudah ada sejak v2 tapi tidak pernah dipanggil
     dari mana pun — jadi selama ini tidak berguna.

     Navigasi di aplikasi ini memuat ulang halaman sepenuhnya
     (MK_AUTH._go → window.location). Karena cache disimpan di
     localStorage dan dipakai bersama antar halaman, data yang
     diambil sekarang tetap ada saat halaman berikutnya dibuka.

     Jadi: setelah halaman ini selesai dan browser menganggur,
     ambil data yang BELUM segar untuk halaman lain yang boleh
     dibuka oleh peran user ini. Berkat lapisan batching di atas,
     semuanya berangkat sebagai SATU permintaan.

     Efeknya: klik menu → halaman tampil seketika, tanpa spinner.

     Ini tidak pernah menghambat halaman yang sedang dibuka:
     dijalankan lewat requestIdleCallback dan baru setelah jeda. */
  const PAGE_NEEDS = {
    'input-penjualan.html': ['getPelanggan', 'getProduk', 'getTodayNotas'],
    'data-penjualan.html':  ['getAllNotas', 'getPelanggan', 'getProduk'],
    'tagihan.html':         ['getPelanggan', 'getNotaBelumTagih', 'getTagihan', 'getKredit', 'getAllNotasLite'],
    'pelanggan.html':       ['getPelanggan', 'getProduk', 'getTagihan', 'getKredit'],
    'produk.html':          ['getProduk'],
    'langsiran.html':       ['getProduk', 'getLangsiran'],
    'stock.html':           ['getProduk', 'getStock'],
    'ringkasan.html':       ['getProduk', 'getAllNotas', 'getLangsiran', 'getStock'],
    'stats.html':           ['getAllNotas', 'getProduk', 'getLangsiran', 'getStock'],
  };

  // Halaman yang benar-benar bisa dibuka tiap peran (mengikuti sidebar auth.js).
  const ROLE_PAGES = {
    produksi:  ['langsiran.html'],
    packaging: ['input-penjualan.html', 'data-penjualan.html', 'langsiran.html', 'stock.html',
                'ringkasan.html', 'tagihan.html', 'stats.html', 'pelanggan.html', 'produk.html'],
  };
  ROLE_PAGES.admin = ROLE_PAGES.packaging;

  MK_NET.autoWarm = function () {
    if (!navigator.onLine) return;
    if (typeof MK_CONFIG === 'undefined' || !MK_CONFIG.GAS) return;

    let role = '';
    try { role = (MK_AUTH.get() || {}).role || ''; } catch (e) {}
    const pages = ROLE_PAGES[role];
    if (!pages) return;                       // belum login → jangan ambil apa-apa

    const here = (location.pathname.split('/').pop() || '').toLowerCase();

    // Kumpulkan action untuk halaman LAIN yang boleh dibuka user ini.
    const want = {};
    pages.forEach(pg => {
      if (pg === here) return;                // halaman ini mengurus dirinya sendiri
      (PAGE_NEEDS[pg] || []).forEach(a => { want[a] = 1; });
    });

    MK_NET.warm(MK_CONFIG.GAS, Object.keys(want));
  };

  window.addEventListener('online',  () => { setNetState(true); MK_NET.flush(); });
  window.addEventListener('offline', () => setNetState(false));
  window.addEventListener('DOMContentLoaded', () => {
    renderBanner();
    if (navigator.onLine && qRead().length) MK_NET.flush();

    // Beri halaman ini kesempatan menyelesaikan pengambilan datanya sendiri
    // lebih dulu, baru panaskan halaman lain saat browser menganggur.
    setTimeout(() => { try { MK_NET.autoWarm(); } catch (e) {} }, 2500);
  });
})();
