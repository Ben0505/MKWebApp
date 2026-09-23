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
  const FKEY      = 'mk_wf';        // simpanan GAGAL (lihat di bawah)
  const MAX_FAIL  = 20;             // batas wajar, supaya tidak menumpuk
  /* Selama masih di dalam batas ini, data lama tetap DITAMPILKAN
     sambil versi barunya diambil di latar belakang. Dinaikkan dari 24
     jam ke 7 hari khusus untuk sambungan yang lemah: kalau sudah lewat
     batas, simpanan dibuang dan layar jadi kosong sampai jaringan
     berhasil — justru di saat jaringannya paling tidak bisa
     diandalkan. Nota minggu lalu jauh lebih berguna daripada tabel
     kosong, dan keterangan di bilah status sudah memberi tahu bahwa
     yang tampil adalah data tersimpan. */
  const HARD_TTL  = 7 * 24 * 3600e3;
  const TIMEOUT   = 12000;          // 12 dtk — dipakai untuk TULIS
  /* Baca diberi waktu jauh lebih panjang. getAllNotas di Code.gs yang
     masih terpasang membaca SELURUH sheet Penjualan ditambah SELURUH
     sheet Items, tanpa cache di sisi server — pada data sungguhan itu
     lewat dari 12 detik. Dengan batas lama, permintaan itu tidak
     pernah berhasil: diputus di detik 12, diulang, diputus lagi,
     tiga kali, lalu menyerah setelah ~36 detik tanpa satu baris pun
     tampil. Satu percobaan panjang lebih berguna daripada tiga
     percobaan yang semuanya pasti kalah. */
  const READ_TIMEOUT = 25000;
  const RETRIES   = 1;              // total 2 percobaan
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
  /* ─── Pembatas permintaan serentak ──────────────────────────
     Di sambungan lemah, tiga permintaan yang berangkat bersamaan
     sama-sama merayap: yang pertama baru selesai setelah ketiganya
     hampir selesai. Dengan batas dua, data yang ditunggu halaman
     sampai lebih cepat, dan Apps Script — yang juga membatasi jumlah
     eksekusi bersamaan — tidak kewalahan.                        */
  const MAX_PARALEL = 2;
  let jalan = 0;
  const antre = [];
  function slot() {
    if (jalan < MAX_PARALEL) { jalan++; return Promise.resolve(); }
    return new Promise(r => antre.push(r));
  }
  function lepas() {
    const next = antre.shift();
    if (next) next(); else jalan = Math.max(0, jalan - 1);
  }

  async function netGet(url, tries) {
    tries = (tries == null) ? RETRIES : tries;
    let lastErr;
    for (let i = 0; i <= tries; i++) {
      /* Kalau peramban sendiri bilang tidak ada jaringan, tidak ada
         gunanya menunggu sampai batas waktu. Tanpa ini, membuka
         halaman dalam keadaan offline berarti menatap "Mengambil
         data..." selama hampir satu menit sebelum bilah status
         akhirnya berkata jujur. (Sebaliknya tidak berlaku: onLine
         yang bernilai true belum tentu berarti server terjangkau,
         jadi hanya nilai false yang dipercaya.) */
      if (!navigator.onLine) { lastErr = new Error('Tidak ada sambungan'); break; }

      // Giliran diambil DULU, baru jamnya mulai. Kalau dibalik,
      // permintaan yang masih mengantre bisa kehabisan waktu sebelum
      // sempat berangkat sama sekali.
      await slot();
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), READ_TIMEOUT);
      try {
        const res = await window.fetch(url, { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      } catch (e) {
        clearTimeout(t);
        lastErr = e;
        if (i < tries) await new Promise(r => setTimeout(r, 600 * Math.pow(2, i)));
      } finally { lepas(); }
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

  /* ─── Permintaan spekulatif (pemanasan halaman lain) ────────
     autoWarm() meminta data untuk halaman yang BELUM dibuka. Itu
     tebakan, bukan permintaan pengguna, jadi dua aturan berlaku:

       1. Tidak boleh berubah jadi badai permintaan. Kalau batch
          tidak tersedia, mundur ke permintaan satuan berarti 10
          eksekusi Apps Script sekaligus — Google membatasi jumlah
          eksekusi bersamaan, jadi sebagian gagal dan bilah status
          jadi merah. Lebih baik pemanasannya dibatalkan saja.
       2. Tidak boleh mewarnai bilah status merah. Tebakan yang
          gagal tentang halaman yang tidak sedang dibuka bukan
          gangguan sambungan yang perlu dilaporkan.

     Kalau halaman ikut meminta action yang sama, statusnya naik
     jadi permintaan sungguhan dan kedua aturan itu tidak berlaku. */
  const spec = {};            // action -> true selama hanya pemanasan yang menunggu

  /* ─── Action yang sudah diambil oleh satu putaran pengiriman ─────
     flushBatch membaca Object.keys(waiting), tapi isi waiting baru
     dihapus di settle(). Kalau backend lambat, permintaan putaran
     pertama masih menggantung saat putaran kedua berjalan — dan
     putaran kedua ikut mengambil action yang sama sekali lagi.

     Akibatnya dua: permintaan ganda untuk data yang sama, dan
     pemanasan yang seharusnya murni spekulatif jadi tercampur
     action sungguhan, sehingga tidak bisa dibatalkan diam-diam.
     Di mock yang menjawab seketika ini tidak pernah terlihat. */
  const claimed = {};

  /* Apakah backend mengenal action=batch. null = belum tahu.
     Disimpan per-tab: kalau Code.gs dideploy ulang, tab baru
     akan memeriksanya lagi. */
  let batchOK = null;
  try { if (S.getItem('mk_nobatch') === '1') batchOK = false; } catch (e) {}
  function markNoBatch() {
    batchOK = false;
    try { S.setItem('mk_nobatch', '1'); } catch (e) {}
  }

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
    delete spec[action];
    delete claimed[action];

    busyCount = Math.max(0, busyCount - 1);
    if (!busyCount) busySince = 0;
    if (!err) lastSync = Date.now();
    renderBar();

    if (err) w.forEach(x => x.reject(err));
    else     w.forEach(x => x.resolve(data));
  }

  /** Ambil satu action sendirian (fallback & kasus permintaan tunggal). */
  async function fetchSingle(action, url, quiet) {
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
      // Pemanasan yang gagal tidak menjatuhkan status sambungan.
      if (!quiet) setNetState(false);
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

  async function resolveMissing(action, url, quiet) {
    const alt = ACTION_FALLBACK[action];
    if (alt) {
      try {
        const d = await netGet(`${url}?action=${alt}`);
        if (d && d.success) { setNetState(true); absorb(action, d); settle(action, d); return; }
      } catch (e) { /* jatuh ke percobaan satuan di bawah */ }
    }
    await fetchSingle(action, url, quiet).catch(() => {});
  }

  async function flushBatch() {
    batchTimer = null;
    // Hanya yang belum diambil putaran sebelumnya (lihat `claimed`).
    const all = Object.keys(waiting).filter(a => !claimed[a]);
    const url = batchUrl;
    if (!all.length || !url) return;
    all.forEach(a => { claimed[a] = true; });

    /* Sebuah action bisa membawa parameternya sendiri, misalnya
       'getNotasRange&dari=2026-09-17&sampai=2026-09-23'. Bentuk itu
       tidak muat di daftar a=... milik batch, jadi dikirim satuan.
       Tandanya tetap dipegang (claimed) sampai settle(), supaya
       putaran berikutnya tidak mengambilnya lagi. */
    const actions = all.filter(a => a.indexOf('&') === -1);
    all.filter(a => a.indexOf('&') !== -1)
       .forEach(a => { fetchSingle(a, url, !!spec[a]).catch(() => {}); });
    if (!actions.length) return;

    // Semua-spekulatif? Maka tidak ada satu pun yang ditunggu pengguna.
    const allSpec = actions.every(a => spec[a]);

    /* Mundur ke permintaan satuan = satu eksekusi Apps Script per action.
       Untuk data yang ditunggu pengguna itu memang harus dilakukan. Untuk
       pemanasan, tidak: 10 eksekusi sekaligus melewati batas eksekusi
       bersamaan Google, sebagian gagal, dan bilah status jadi merah —
       padahal tidak ada yang meminta datanya. Jadi pemanasannya
       dibatalkan diam-diam, dan halaman tetap mengambil datanya sendiri
       saat benar-benar dibuka. */
    const giveUp = () => actions.forEach(a => settle(a, null, new Error('warm dibatalkan')));
    const fanOut = () => Promise.all(actions.map(a => fetchSingle(a, url, allSpec).catch(() => {})));

    // Cuma satu → tidak ada gunanya dibungkus batch.
    if (actions.length === 1) {
      await fetchSingle(actions[0], url, allSpec).catch(() => {});
      return;
    }

    // Sudah diketahui backend-nya belum kenal batch: jangan buang satu
    // perjalanan lagi untuk memeriksanya.
    if (batchOK === false) { if (allSpec) return giveUp(); await fanOut(); return; }

    let res = null;
    try {
      res = await netGet(`${url}?action=batch&a=${encodeURIComponent(actions.join(','))}`);
    } catch (e) {
      // Batch gagal (jaringan / URL terlalu panjang) → coba satuan.
      if (allSpec) return giveUp();
      setNetState(false);
      await fanOut();
      return;
    }

    // Backend lama tidak mengenal action=batch dan membalas pesan status
    // biasa. Kenali itu, ingat, lalu mundur ke permintaan satuan.
    if (!res || !res.batch || !res.results) {
      markNoBatch();
      if (allSpec) return giveUp();
      await fanOut();
      return;
    }

    batchOK = true;
    setNetState(true);
    const missing = [];
    actions.forEach(a => {
      const d = res.results[a];
      if (d === undefined) { missing.push(a); return; }   // backend tidak kenal action ini
      absorb(a, d);
      settle(a, d);
    });
    if (missing.length) await Promise.all(missing.map(a => resolveMissing(a, url, allSpec)));
  }

  /** Minta data segar dari server. Otomatis digabung dengan permintaan
   *  lain yang terjadi pada tick yang sama. */
  function revalidate(action, gasUrl, isSpec) {
    // Permintaan sungguhan menaikkan status action yang tadinya
    // cuma pemanasan, termasuk kalau permintaannya sudah berjalan.
    if (!isSpec) delete spec[action];
    if (inflight[action]) return inflight[action];
    if (isSpec) spec[action] = true;

    const p = new Promise((resolve, reject) => {
      (waiting[action] = waiting[action] || []).push({ resolve, reject });
    });
    inflight[action] = p;
    p.catch(() => {});          // penolakan ditangani pemanggil; jangan bising di console

    if (!busyCount) busySince = Date.now();
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
    const served = (d) => { haveData = true; renderBar(); return d; };

    // 1. Cache segar → langsung pakai
    if (o && !o.dirty && (now - o.ts) <= softTTL(action)) return served(o.data);

    // 2. Ada cache tapi kotor (habis nulis) → wajib tunggu server,
    //    kalau gagal baru mundur ke cache lama
    if (o && o.dirty) {
      try { return served(await revalidate(action, gasUrl)); }
      catch (e) {
        if (now - o.ts <= HARD_TTL) { flagStale(); return served(o.data); }
        throw e;
      }
    }

    // 3. Ada cache basi (kadaluarsa waktu) → tampilkan SEKARANG,
    //    ambil versi baru di latar belakang
    if (o && (now - o.ts) <= HARD_TTL) {
      revalidate(action, gasUrl).catch(() => {});
      return served(o.data);
    }

    // 4. Tidak ada cache sama sekali → harus tunggu jaringan
    return served(await revalidate(action, gasUrl));
  };

  /* ─── Antrian tulis offline ───────────────────────────── */
  function qRead()  { try { return JSON.parse(S.getItem(QKEY) || '[]'); } catch (e) { return []; } }
  function qWrite(a){ try { S.setItem(QKEY, JSON.stringify(a)); } catch (e) {} }

  /* ─── Simpanan perubahan yang GAGAL disimpan ────────────────
     Bedanya dengan QKEY di atas: antrian itu hanya terisi kalau
     pemanggil meminta opts.queue, dan tidak ada satu pun halaman
     yang memakainya. Semua halaman menyimpan lewat fetch(...POST)
     biasa, yang dicegat perisai di bawah berkas ini.

     Dulu, kalau simpanan itu gagal sampai ke server, yang terjadi
     hanya setNetState(false) — bilah jadi merah dengan tulisan
     "Gagal mengambil data dari server". Dua cacat sekaligus:
     kalimatnya salah (yang gagal menyimpan, bukan mengambil), dan
     merahnya hilang sendiri begitu ada permintaan BACA yang
     berhasil. Pemanasan latar belakang berjalan beberapa detik
     kemudian, berhasil, lalu bilah kembali hijau — peringatannya
     menghapus dirinya sendiri padahal datanya tidak pernah masuk.

     Simpanan ini bertahan di localStorage, jadi tetap ada walau
     halaman ditutup, dan hanya hilang kalau kiriman ulangnya
     benar-benar berhasil.                                      */
  function wfRead()  { try { return JSON.parse(S.getItem(FKEY) || '[]'); } catch (e) { return []; } }
  function wfWrite(a){ try { S.setItem(FKEY, JSON.stringify(a)); } catch (e) {} }
  function wfAdd(url, body) {
    var act = '';
    try { act = (JSON.parse(body) || {}).action || ''; } catch (e) {}
    const a = wfRead();
    a.push({ url: url, body: body, action: act, at: Date.now() });
    wfWrite(a.slice(-MAX_FAIL));
    renderBar();
  }

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
        if (!o || Date.now() - o.ts > softTTL(a)) revalidate(a, gasUrl, true).catch(() => {});
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
  /* Apakah layar sedang memegang data yang bisa dipakai — entah baru
     dari server, entah dari simpanan. Ini yang membedakan "gagal, dan
     kamu tidak punya apa-apa" dari "gagal menyegarkan, tapi datanya
     ada di layar". Tanpa pembedaan ini bilah status berwarna merah
     padahal tabelnya penuh: MK_CACHE.fetch menampilkan simpanan lama
     lebih dulu lalu menyegarkan di latar belakang, dan penyegaran
     yang gagal itulah yang mewarnainya merah. */
  let haveData = false;
  let busyCount = 0;          // berapa action sedang diambil dari server
  let busySince = 0;          // kapan pengambilan yang sekarang dimulai
  let saveCount = 0;          // berapa perubahan sedang DIKIRIM ke server
  let retrying  = false;      // kiriman ulang atas permintaan pengguna
  let lastSync  = 0;          // kapan terakhir kali data berhasil masuk
  let hasNew    = false;      // server mengirim isi yang berbeda

  function setNetState(ok) { if (netOk !== ok) { netOk = ok; renderBar(); } }

  /* Pakai baris pemberitahuan kalau mk-toast.js ada; kalau tidak,
     pakai pil bawaan berkas ini. */
  function showMsg(m, ok) {
    if (window.MK_TOAST) window.MK_TOAST.show(m, ok); else toast(m);
  }
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
    document.getElementById('mk-net-btn').addEventListener('click', () => {
      // Tombol yang sama, dua tugas: kalau ada perubahan yang gagal
      // disimpan, itu yang harus diurus lebih dulu — bukan memuat
      // ulang halaman, yang tidak menyelamatkan apa pun.
      if (wfRead().length && MK_NET.retryWrites) MK_NET.retryWrites();
      else MK_NET.refresh();
    });
    return bar;
  }

  function renderBar() {
    const bar = buildBar();
    if (!bar) return;           // <body> belum ada — akan digambar saat DOM siap
    const txt = document.getElementById('mk-net-txt');
    const btn = document.getElementById('mk-net-btn');
    const lbl = document.getElementById('mk-net-btn-lbl');
    const n   = qRead().length;
    const nf  = wfRead().length;
    const narrow = window.innerWidth < 420;

    bar.className = '';
    btn.disabled  = false;
    if (!busyCount) clearTimeout(renderBar._tick);

    if (saveCount > 0) {
      // KUNING — perubahan sedang dikirim
      bar.className = 'busy';
      txt.textContent = retrying ? 'Mengirim ulang...' : 'Menyimpan...';
      btn.disabled = true;
      lbl.textContent = narrow ? '' : 'Menyimpan';

    } else if (nf > 0) {
      /* MERAH — dan menetap.

         Sengaja diperiksa SEBELUM busyCount dan netOk. Kalau tidak,
         pengambilan data biasa yang kebetulan berjalan akan menimpa
         peringatan ini dengan "Mengambil data..." lalu "Data terbaru",
         persis cacat yang mau diperbaiki. Satu-satunya yang boleh
         menutupi peringatan ini adalah kiriman ulang yang sedang
         berjalan, karena itu memang penanganannya.

         Hilang hanya kalau kiriman ulangnya berhasil, atau kalau
         server menjawab dengan penolakan tegas — lihat retryWrites(). */
      bar.className = 'bad';
      txt.textContent = navigator.onLine
        ? (nf === 1 ? 'Perubahan gagal disimpan' : nf + ' perubahan gagal disimpan')
        : `Tidak ada sambungan — ${nf} perubahan gagal disimpan`;
      lbl.textContent = 'Coba lagi';

    } else if (busyCount > 0) {
      /* KUNING — sedang berjalan.
         Di sambungan lemah ini bisa bertahan puluhan detik. Tulisan
         yang diam saja terlihat seperti aplikasi yang menggantung,
         jadi detiknya ikut ditampilkan setelah 3 detik pertama —
         cukup untuk membedakan "sedang jalan" dari "macet", tanpa
         membuat pemuatan cepat jadi ramai. */
      bar.className = 'busy';
      const dtk = busySince ? Math.floor((Date.now() - busySince) / 1000) : 0;
      txt.textContent = dtk >= 3 ? `Mengambil data... (${dtk} dtk)` : 'Mengambil data...';
      btn.disabled = true;
      lbl.textContent = narrow ? '' : 'Memuat';
      clearTimeout(renderBar._tick);
      renderBar._tick = setTimeout(renderBar, 1000);

    } else if (!navigator.onLine) {
      /* Aturan warna: MERAH berarti tidak bisa bekerja. KUNING berarti
         bisa bekerja, tapi ada yang perlu diketahui. Jadi kalau data
         masih terpampang di layar, tidak ada sambungan bukan keadaan
         merah — orangnya masih bisa membaca notanya. */
      bar.className = haveData ? 'busy' : 'bad';
      txt.textContent = n
        ? `Tidak ada sambungan — ${n} perubahan menunggu`
        : (haveData
            ? 'Tidak ada sambungan — data tersimpan masih bisa dibaca'
            : 'Tidak ada sambungan — belum ada data tersimpan');
      lbl.textContent = narrow ? '' : 'Coba lagi';

    } else if (!netOk) {
      /* Server tidak menjawab. Kalau tabelnya sudah terisi — dan itu
         keadaan yang paling sering, karena MK_CACHE.fetch menampilkan
         simpanan lama dulu lalu menyegarkan di latar — yang gagal
         hanyalah PENYEGARANNYA. Dulu ini diwarnai merah dan berbunyi
         "Gagal mengambil data dari server", padahal datanya ada di
         depan mata. Itu membuat orang mengira aplikasinya rusak. */
      bar.className = haveData ? 'busy' : 'bad';
      txt.textContent = haveData
        ? 'Data tersimpan · gagal memperbarui dari server'
        : 'Gagal mengambil data dari server';
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
  setInterval(() => { if (!busyCount && !saveCount && !hasNew) renderBar(); }, 30000);

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
    /* Kalau mk-toast.js dimuat, pesan ini memakai baris yang sama
       dengan pesan halaman, supaya tidak ada dua pil melayang yang
       saling menutupi di atas bilah status. */
    if (window.MK_TOAST) { window.MK_TOAST.show(msg, true); return; }
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
          /* Setiap percobaan sudah habis dan kita TIDAK TAHU apakah
             datanya sempat masuk. Itulah yang dicatat: bukan "server
             menolak", tapi "tidak ada jawaban". Penolakan tegas dari
             server (HTTP 200 dengan success:false) sengaja TIDAK
             dicatat di sini — halaman sudah menampilkan pesannya
             sendiri, dan mengirim ulang tidak akan mengubah jawaban,
             jadi bilahnya akan merah selamanya tanpa jalan keluar. */
          wfAdd(url, body);
          throw e;
        }
      };

      saveCount++;
      renderBar();
      return attempt(0).finally(() => { saveCount = Math.max(0, saveCount - 1); renderBar(); });
    };

    /* ─── Kirim ulang perubahan yang gagal ────────────────────
       Aman diulang: perisai di atas menyisipkan clientRef ke setiap
       badan permintaan, dan doPost di Code.gs v2 mengingat clientRef
       selama 6 jam lalu membalas hasil yang lama. Jadi kalau ternyata
       simpanan pertama SUDAH masuk dan yang hilang cuma jawabannya,
       kiriman ulang tidak membuat nota kedua — server menjawab dengan
       hasil yang sama dan catatannya dibersihkan.                  */
    MK_NET.retryWrites = async function () {
      const jobs = wfRead();
      if (!jobs.length) return;
      if (!navigator.onLine) { showMsg('⚠ Masih tidak ada sambungan', false); return; }

      retrying = true; saveCount++; renderBar();
      const sisa = [];
      let ok = 0, ditolak = 0;

      for (const job of jobs) {
        try {
          const res = await raw(job.url, { method: 'POST', body: job.body });
          if (!res.ok) { sisa.push(job); continue; }
          let d = null;
          try { d = await res.clone().json(); } catch (e) {}
          // Server menjawab. Entah berhasil atau menolak, nasibnya sudah
          // pasti — jadi tidak perlu terus ditandai sebagai "tidak tahu".
          if (d && d.success === false) ditolak++; else ok++;
          /* Server menjawab, berarti jaringannya sehat. Tanpa ini,
             netOk yang tadi dijatuhkan oleh kegagalan kirim tetap
             false, dan bilah tinggal merah dengan kalimat yang
             salah ("Gagal mengambil data") padahal tidak ada lagi
             yang tertunda. */
          setNetState(true);
        } catch (e) {
          sisa.push(job);          // masih tidak ada jawaban
        }
      }

      wfWrite(sisa);
      retrying = false; saveCount = Math.max(0, saveCount - 1);
      if (ok) { setNetState(true); MK_CACHE.bustAll(); }
      renderBar();

      if (sisa.length) {
        showMsg(`⚠ ${sisa.length} perubahan masih gagal disimpan`, false);
      } else if (ditolak) {
        showMsg(`⚠ ${ditolak} perubahan ditolak server — periksa datanya`, false);
      } else {
        showMsg(`✓ ${ok} perubahan berhasil disimpan`, true);
        /* Muat ulang supaya layar menampilkan isi yang sudah masuk —
           tapi jangan kalau ada isian yang sedang diketik, karena
           memuat ulang akan menghapusnya. Itu menukar satu masalah
           dengan masalah yang sama. */
        if (!hasUnsavedInput()) setTimeout(() => location.reload(), 1200);
      }
    };

    MK_NET.failedWrites = () => wfRead().length;
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
