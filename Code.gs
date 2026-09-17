// ============================================================
//  BUKU MK — Google Apps Script Backend
//  Spreadsheet: BUKU MK - Web
//  ============================================================
//
//  CARA SETUP (sekali saja):
//  1. Buat Google Sheet baru, beri nama "BUKU MK - Web"
//  2. Buka Extensions → Apps Script
//  3. Hapus kode lama, paste semua kode ini
//  4. Pilih fungsi "setupAll" di dropdown atas → Run
//  5. Izinkan akses saat diminta
//  6. Deploy → New Deployment → Web App
//     - Execute as: Me
//     - Who has access: Anyone
//  7. Copy URL deployment → paste ke semua file HTML (variabel GAS / GAS_URL)
//
//  CATATAN PENTING:
//  - Setiap kali kode di sini diubah, harus deploy ulang (New Deployment atau Manage → Edit)
//  - URL deployment TIDAK berubah selama pakai "Manage → Edit" pada deployment yang sama
// ============================================================

const SS = SpreadsheetApp.getActiveSpreadsheet();

// ── Nama sheet ───────────────────────────────────────────────
const SH_USERS      = 'Users';
const SH_PELANGGAN  = 'Pelanggan';
const SH_PRODUK     = 'Produk';
const SH_PENJUALAN  = 'Data Penjualan';
const SH_ITEMS      = 'Item Penjualan';
const SH_TAGIHAN    = 'Tagihan';
const SH_KREDIT     = 'Kredit';
const SH_LANGSIRAN  = 'Langsiran';
const SH_STOCK      = 'Stock';

// ── Warna tema ───────────────────────────────────────────────
const CLR_HEADER   = '#1A1714';
const CLR_WHITE    = '#FFFFFF';
const CLR_LUNAS    = '#EDF6F1';
const CLR_PENDING  = '#FEF8EC';
const CLR_TTP      = '#FEF3F3';
const CLR_KREDIT   = '#E6F1FB';

// ============================================================
//  SETUP — Jalankan setupAll() sekali untuk inisialisasi
// ============================================================
function setupAll() {
  setupUsers();
  setupPelanggan();
  setupProduk();
  setupPenjualan();
  setupItemPenjualan();
  setupTagihan();
  setupKredit();
  setupLangsiran();
  setupStock();

  SpreadsheetApp.getUi().alert(
    '✓ Setup BUKU MK selesai!\n\n' +
    '9 sheet berhasil dibuat:\n' +
    '• Users\n• Pelanggan\n• Produk\n' +
    '• Data Penjualan\n• Item Penjualan\n' +
    '• Tagihan\n• Kredit\n• Langsiran\n• Stock\n\n' +
    'Silakan deploy sebagai Web App.'
  );
}

// ── Setup: Users ─────────────────────────────────────────────
function setupUsers() {
  let sh = _getOrCreate(SH_USERS);
  if (sh.getLastRow() > 0) return;

  const headers = ['ID','Nama','Username','Password','Role','Inisial','Warna','BG','Aktif'];
  sh.appendRow(headers);
  _formatHeader(sh, headers.length);
  sh.setFrozenRows(1);

  // Data user awal — ubah password setelah setup!
  const users = [
    ['u1','BENNY',  'benny', 'mk123',      'admin',     'BE','#534AB7','#F0EFFE','TRUE'],
    ['u2','WAHYU',  'wahyu', 'produksi1',  'produksi',  'WH','#185FA5','#E6F1FB','TRUE'],
    ['u3','HENDRA', 'hendra','produksi2',  'produksi',  'HD','#8B5C00','#FEF8EC','TRUE'],
    ['u4','RINI',   'rini',  'packing1',   'packaging', 'RI','#1A6B45','#EDF6F1','TRUE'],
    ['u5','SARI',   'sari',  'packing2',   'packaging', 'SA','#1A6B45','#EDF6F1','TRUE'],
  ];
  users.forEach(r => sh.appendRow(r));

  const widths = [60,120,100,100,90,70,80,80,60];
  widths.forEach((w,i) => sh.setColumnWidth(i+1,w));
}

// ── Setup: Pelanggan ─────────────────────────────────────────
function setupPelanggan() {
  let sh = _getOrCreate(SH_PELANGGAN);
  if (sh.getLastRow() > 0) return;

  const headers = [
    'ID',           // A
    'Nama',         // B
    'Nama Alias',   // C
    'Grouping',     // D
    'Alamat / Kota',// E
    'Kontak',       // F
    'Bank',         // G
    'No. Rekening', // H
    'Tujuan',       // I
    'Ongkir',       // J
    'Kredit',       // K — saldo kelebihan bayar
    'Aktif',        // L
    'Harga Khusus', // M — JSON string satuanList
    'Timestamp',    // N
  ];
  sh.appendRow(headers);
  _formatHeader(sh, headers.length);
  sh.setFrozenRows(1);

  const widths = [80,140,90,120,130,120,80,130,100,100,120,60,300,160];
  widths.forEach((w,i) => sh.setColumnWidth(i+1,w));
  sh.getRange('J:K').setNumberFormat('#,##0');
  sh.getRange('N:N').setNumberFormat('dd/mm/yyyy hh:mm:ss');
}

// ── Setup: Produk ────────────────────────────────────────────
function setupProduk() {
  let sh = _getOrCreate(SH_PRODUK);
  if (sh.getLastRow() > 0) return;

  const headers = [
    'ID',             // A — PRD-001
    'Nama Produk',    // B
    'Nama Alias',     // C
    'Kategori',       // D
    'Satuan List',    // E — JSON: [{satuan,harga,berat,delta}]
    'Aktif',          // F
  ];
  sh.appendRow(headers);
  _formatHeader(sh, headers.length);
  sh.setFrozenRows(1);

  const widths = [80,160,120,120,400,60];
  widths.forEach((w,i) => sh.setColumnWidth(i+1,w));
}

// ── Setup: Data Penjualan ────────────────────────────────────
function setupPenjualan() {
  let sh = _getOrCreate(SH_PENJUALAN);
  if (sh.getLastRow() > 0) return;

  const headers = [
    'ID Nota',        // A — YYYYMMDD-XXXX
    'Tanggal',        // B
    'No. Nota',       // C
    'Nama Pelanggan', // D
    'Nama Alias',     // E
    'Kota',           // F
    'Grouping',       // G
    'Subtotal',       // H
    'Ongkir',         // I
    'Retur',          // J
    'Total',          // K
    'Status',         // L — LUNAS / PENDING / TTP
    'Catatan',        // M
    'Timestamp',      // N
  ];
  sh.appendRow(headers);
  _formatHeader(sh, headers.length);
  sh.setFrozenRows(1);

  const widths = [160,100,80,140,90,100,120,130,110,110,130,80,220,160];
  widths.forEach((w,i) => sh.setColumnWidth(i+1,w));
  sh.getRange('H:K').setNumberFormat('#,##0');
  sh.getRange('B:B').setNumberFormat('dd/mm/yyyy');
  sh.getRange('N:N').setNumberFormat('dd/mm/yyyy hh:mm:ss');
}

// ── Setup: Item Penjualan ────────────────────────────────────
function setupItemPenjualan() {
  let sh = _getOrCreate(SH_ITEMS);
  if (sh.getLastRow() > 0) return;

  const headers = [
    'ID Nota',        // A — FK ke Data Penjualan
    'No. Nota',       // B
    'Tanggal',        // C
    'Nama Pelanggan', // D
    'Nama Produk',    // E
    'Satuan',         // F
    'Qty',            // G
    'Harga Satuan',   // H
    'Jumlah',         // I
  ];
  sh.appendRow(headers);
  _formatHeader(sh, headers.length);
  sh.setFrozenRows(1);

  const widths = [160,80,100,140,160,70,60,120,130];
  widths.forEach((w,i) => sh.setColumnWidth(i+1,w));
  sh.getRange('G:I').setNumberFormat('#,##0');
  sh.getRange('C:C').setNumberFormat('dd/mm/yyyy');
}

// ── Setup: Tagihan ───────────────────────────────────────────
function setupTagihan() {
  let sh = _getOrCreate(SH_TAGIHAN);
  if (sh.getLastRow() > 0) return;

  const headers = [
    'ID',             // A
    'No. Tagihan',    // B — unik, misal TAG-2026-001
    'Tanggal',        // C
    'Nama Pelanggan', // D
    'Alias',          // E
    'Kota',           // F
    'Grouping',       // G
    'Nota IDs',       // H — JSON array ID nota
    'Nota List',      // I — JSON array no nota (untuk display)
    'Jml Nota',       // J
    'Tgl Awal',       // K
    'Tgl Akhir',      // L
    'Total Tagihan',  // M
    'Kredit Digunakan',// N
    'Total Bayar',    // O
    'Sisa',           // P
    'Status',         // Q — LUNAS / PENDING / KELEBIHAN
    'Catatan',        // R
    'Bayar Rows',     // S — JSON array pembayaran [{cara,jumlah,ket,tgl}]
    'Timestamp',      // T
  ];
  sh.appendRow(headers);
  _formatHeader(sh, headers.length);
  sh.setFrozenRows(1);

  const widths = [80,110,100,140,80,100,120,200,150,70,100,100,130,130,120,120,80,200,300,160];
  widths.forEach((w,i) => sh.setColumnWidth(i+1,w));
  sh.getRange('M:P').setNumberFormat('#,##0');
  sh.getRange('C:C').setNumberFormat('dd/mm/yyyy');
  sh.getRange('K:L').setNumberFormat('dd/mm/yyyy');
  sh.getRange('T:T').setNumberFormat('dd/mm/yyyy hh:mm:ss');
}

// ── Setup: Kredit ────────────────────────────────────────────
function setupKredit() {
  let sh = _getOrCreate(SH_KREDIT);
  if (sh.getLastRow() > 0) return;

  const headers = [
    'ID',             // A
    'Nama Pelanggan', // B
    'Grouping',       // C
    'From Tagihan',   // D — no tagihan yang menghasilkan kredit ini
    'Tanggal',        // E
    'Jumlah',         // F
    'Terpakai',       // G — TRUE/FALSE
  ];
  sh.appendRow(headers);
  _formatHeader(sh, headers.length);
  sh.setFrozenRows(1);

  const widths = [80,140,120,120,100,130,80];
  widths.forEach((w,i) => sh.setColumnWidth(i+1,w));
  sh.getRange('F:F').setNumberFormat('#,##0');
  sh.getRange('E:E').setNumberFormat('dd/mm/yyyy');
}

// ── Setup: Langsiran ─────────────────────────────────────────
function setupLangsiran() {
  let sh = _getOrCreate(SH_LANGSIRAN);
  if (sh.getLastRow() > 0) return;

  const headers = [
    'ID',             // A — LNG-001
    'Tanggal',        // B
    'Waktu Kirim',    // C
    'Plat Nomor',     // D
    'Supir',          // E
    'Status',         // F — DIKIRIM / TERVERIFIKASI / KENDALA
    'Items',          // G — JSON: [{produk,satuan,qty,berat_kg}]
    'Catatan Kirim',  // H
    'Waktu Datang',   // I
    'Catatan Terima', // J
    'Input Kirim',    // K
    'Input Terima',   // L
    'Timestamp',      // M
  ];
  sh.appendRow(headers);
  _formatHeader(sh, headers.length);
  sh.setFrozenRows(1);

  const widths = [90,100,90,100,100,110,400,200,90,200,100,100,160];
  widths.forEach((w,i) => sh.setColumnWidth(i+1,w));
  sh.getRange('B:B').setNumberFormat('dd/mm/yyyy');
  sh.getRange('M:M').setNumberFormat('dd/mm/yyyy hh:mm:ss');
}

// ── Setup: Stock ─────────────────────────────────────────────
function setupStock() {
  let sh = _getOrCreate(SH_STOCK);
  if (sh.getLastRow() > 0) return;

  const headers = [
    'ID',         // A — auto increment
    'Tanggal',    // B
    'Produk',     // C
    'Satuan',     // D
    'Qty',        // E
    'Catatan',    // F
    'Input By',   // G
    'Timestamp',  // H
  ];
  sh.appendRow(headers);
  _formatHeader(sh, headers.length);
  sh.setFrozenRows(1);

  const widths = [80,100,160,80,80,200,100,160];
  widths.forEach((w,i) => sh.setColumnWidth(i+1,w));
  sh.getRange('E:E').setNumberFormat('#,##0');
  sh.getRange('B:B').setNumberFormat('dd/mm/yyyy');
  sh.getRange('H:H').setNumberFormat('dd/mm/yyyy hh:mm:ss');
}

// ============================================================
//  v2.1 — LAPISAN CACHE, BATCH & DEDUPE
//  ------------------------------------------------------------
//  Semuanya memakai CacheService (memori Google, BUKAN spreadsheet).
//  TIDAK ADA kolom / sheet / struktur data yang berubah.
//
//  Tiga perbaikan dibanding v2:
//   1. SEMUA endpoint baca ikut di-cache (dulu cuma 2 dari 9).
//   2. Cache dipecah jadi potongan → payload besar (getAllNotas)
//      sekarang benar-benar tersimpan. Dulu diam-diam dilewati
//      karena batas 100KB per kunci.
//   3. Pembuangan cache mengikuti SHEET yang benar-benar ditulis,
//      bukan menghapus semuanya tiap kali ada yang menyimpan.
// ============================================================

var _CHUNK      = 90000;      // batas aman per kunci (limit Google: 100KB)
var _MAX_CHUNKS = 10;         // > 900KB → tidak usah di-cache
var _CHUNK_TAG  = '@@chunks:';// penanda bahwa nilai dipecah jadi potongan

/** Baca teks dari cache, menyatukan potongan kalau perlu. */
function _cacheGetText(key) {
  try {
    var c    = CacheService.getScriptCache();
    var head = c.get(key);
    if (head === null || head === undefined) return null;
    if (head.indexOf(_CHUNK_TAG) !== 0) return head;       // nilai utuh

    var n = parseInt(head.slice(_CHUNK_TAG.length), 10);
    if (!(n > 0)) return null;

    var keys = [];
    for (var i = 0; i < n; i++) keys.push(key + '~' + i);

    var all = c.getAll(keys);
    var out = '';
    for (var j = 0; j < n; j++) {
      var part = all[key + '~' + j];
      if (part === null || part === undefined) return null; // potongan hilang → anggap miss
      out += part;
    }
    return out;
  } catch (e) { return null; }
}

/** Simpan teks ke cache, dipecah otomatis kalau lebih dari 90KB. */
function _cachePutText(key, txt, seconds) {
  try {
    var c = CacheService.getScriptCache();
    if (txt.length <= _CHUNK) { c.put(key, txt, seconds); return; }

    var n = Math.ceil(txt.length / _CHUNK);
    if (n > _MAX_CHUNKS) return;                           // terlalu besar, lewati

    var map = {};
    for (var i = 0; i < n; i++) map[key + '~' + i] = txt.substr(i * _CHUNK, _CHUNK);
    c.putAll(map, seconds);
    c.put(key, _CHUNK_TAG + n, seconds);                   // kepala ditulis TERAKHIR
  } catch (e) { /* cache penuh — bukan masalah fatal */ }
}

// ── Peta ketergantungan ──────────────────────────────────────
// sheets : sheet yang DIBACA oleh endpoint ini.
//          Kalau salah satunya ditulis, cache-nya harus dibuang.
//          Perhatikan getPelanggan: ia ikut membaca Data Penjualan
//          dan Tagihan lewat _calcBelumTagih(), jadi menyimpan nota
//          pun harus membuang cache pelanggan.
// ttl    : umur cache di server, dalam detik. Ini cache BERSAMA —
//          satu orang yang membuka halaman ikut menghangatkan
//          cache untuk semua staf lain.
var READS = {
  getPelanggan:      { fn: handleGetPelanggan,      key: 'v2_pelanggan',  ttl: 300,
                       sheets: [SH_PELANGGAN, SH_PENJUALAN, SH_TAGIHAN] },
  getProduk:         { fn: handleGetProduk,         key: 'v2_produk',     ttl: 600,
                       sheets: [SH_PRODUK] },
  getTodayNotas:     { fn: handleGetTodayNotas,     key: 'v2_today',      ttl: 30,
                       sheets: [SH_PENJUALAN, SH_ITEMS] },
  getAllNotas:       { fn: handleGetAllNotas,       key: 'v2_allnotas',   ttl: 60,
                       sheets: [SH_PENJUALAN, SH_ITEMS] },
  getNotaBelumTagih: { fn: handleGetNotaBelumTagih, key: 'v2_belumtagih', ttl: 30,
                       sheets: [SH_PENJUALAN, SH_TAGIHAN] },
  getTagihan:        { fn: handleGetTagihan,        key: 'v2_tagihan',    ttl: 60,
                       sheets: [SH_TAGIHAN] },
  getKredit:         { fn: handleGetKredit,         key: 'v2_kredit',     ttl: 60,
                       sheets: [SH_KREDIT] },
  getLangsiran:      { fn: handleGetLangsiran,      key: 'v2_langsiran',  ttl: 30,
                       sheets: [SH_LANGSIRAN] },
  getStock:          { fn: handleGetStock,          key: 'v2_stock',      ttl: 60,
                       sheets: [SH_STOCK] },
};

/**
 * Jalankan satu endpoint baca dan kembalikan TEKS JSON-nya.
 * Cache dicek lebih dulu; kalau meleset, handler dijalankan lalu disimpan.
 */
function _readText(action) {
  var r = READS[action];
  if (!r) return null;

  var hit = _cacheGetText(r.key);
  if (hit) return hit;

  var txt = r.fn().getContent();
  _cachePutText(r.key, txt, r.ttl);
  return txt;
}

/** Buang cache semua endpoint yang membaca sheet-sheet ini. */
function _bustSheets(sheets) {
  var keys = [];
  for (var action in READS) {
    var r = READS[action];
    for (var i = 0; i < sheets.length; i++) {
      if (r.sheets.indexOf(sheets[i]) !== -1) { keys.push(r.key); break; }
    }
  }
  if (!keys.length) return;

  // Potongan ikut dibuang supaya tidak ada sisa yang menyesatkan.
  var all = keys.slice();
  for (var k = 0; k < keys.length; k++) {
    for (var c = 0; c < _MAX_CHUNKS; c++) all.push(keys[k] + '~' + c);
  }
  try { CacheService.getScriptCache().removeAll(all); } catch (e) {}
}

/** Sudah pernah memproses clientRef ini? Kembalikan hasil lamanya. */
function _seenRef(ref) {
  if (!ref) return null;
  try {
    var prev = CacheService.getScriptCache().get('ref_' + ref);
    return prev ? prev : null;
  } catch (e) { return null; }
}

/** Ingat hasil sebuah clientRef selama 6 jam. */
function _rememberRef(ref, out) {
  if (!ref) return;
  try {
    var txt = out.getContent();
    if (txt.length < 95000) CacheService.getScriptCache().put('ref_' + ref, txt, 21600);
  } catch (e) {}
}

// ============================================================
//  WEB APP — doGet
// ============================================================
function doGet(e) {
  var action = e.parameter.action;

  try {
    if (action === 'login') return handleLogin(e);
    if (action === 'batch') return handleBatch(e);

    if (READS[action]) {
      return ContentService.createTextOutput(_readText(action))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return _json({ status: 'ok', message: 'BUKU MK API aktif.', version: '2.1.0' });
  } catch (err) {
    return _json({ success: false, error: err.message });
  }
}

/**
 * batch — beberapa endpoint baca dalam SATU eksekusi Apps Script.
 *
 * Kenapa ini penting: tiap panggilan ke /exec adalah eksekusi terpisah,
 * dengan cold-start dan pembukaan spreadsheet sendiri-sendiri. tagihan.html
 * dulu memicu LIMA eksekusi sekaligus. Sekarang satu.
 *
 *   GET ?action=batch&a=getPelanggan,getTagihan,getKredit
 *   → { success:true, results:{ getPelanggan:{...}, getTagihan:{...} } }
 *
 * Satu endpoint yang gagal tidak menjatuhkan yang lain.
 */
function handleBatch(e) {
  var raw  = String(e.parameter.a || e.parameter.actions || '');
  var list = raw.split(',')
                .map(function (s) { return s.trim(); })
                .filter(function (s) { return s && READS[s]; });

  if (!list.length) return _json({ success: false, error: 'Tidak ada action yang dikenal.' });

  // Duplikat dibuang — halaman kadang meminta action yang sama dua kali.
  var seen = {}, parts = [];
  for (var i = 0; i < list.length; i++) {
    var a = list[i];
    if (seen[a]) continue;
    seen[a] = true;

    var txt;
    try {
      txt = _readText(a);
    } catch (err) {
      txt = JSON.stringify({ success: false, error: String((err && err.message) || err) });
    }
    parts.push(JSON.stringify(a) + ':' + txt);
  }

  // Dirangkai sebagai teks: payload anak sudah berupa JSON yang sah,
  // jadi tidak perlu parse lalu stringify ulang (hemat waktu & memori).
  return ContentService
    .createTextOutput('{"success":true,"batch":true,"results":{' + parts.join(',') + '}}')
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  WEB APP — doPost
// ============================================================
function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);

    // Kirim-ulang dari mk-net.js? Balas hasil yang lama, jangan proses dua kali.
    var dup = _seenRef(p.clientRef);
    if (dup) {
      return ContentService.createTextOutput(dup)
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Kunci agar dua orang yang menyimpan bersamaan tidak bentrok
    // (khususnya perebutan nomor nota).
    var lock = LockService.getScriptLock();
    var locked = false;
    try { lock.waitLock(25000); locked = true; } catch (e2) {}

    var out;
    try {
      out = _routePost(p);
    } finally {
      if (locked) { try { lock.releaseLock(); } catch (e3) {} }
    }

    _rememberRef(p.clientRef, out);
    return out;

  } catch (err) {
    return _json({ success: false, error: err.message });
  }
}

function _routePost(p) {
  var action = p.action;

  // Sheet yang BENAR-BENAR ditulis oleh tiap aksi.
  // Dari sini _bustSheets() menyimpulkan cache mana yang jadi basi —
  // jadi menyimpan nota tidak lagi ikut membuang cache produk.
  //
  // Catatan yang mudah terlewat:
  //  • saveTagihan juga menyentuh Kredit DAN kolom kredit di Pelanggan
  //    (lewat _addKredit / _updateKreditPelanggan / _markKreditTerpakai).
  //  • updateLangsiran bisa menulis ke Stock saat barang diterima.
  //  • saveStock & addLangsiran dulu TIDAK membuang cache apa pun.
  //    Dulu tidak apa-apa karena endpoint-nya memang belum di-cache;
  //    sekarang di-cache, jadi wajib ada di sini.
  var WRITES = {
    saveNota:        [SH_PENJUALAN, SH_ITEMS],
    updateNota:      [SH_PENJUALAN, SH_ITEMS],

    savePelanggan:   [SH_PELANGGAN],
    updatePelanggan: [SH_PELANGGAN],
    deletePelanggan: [SH_PELANGGAN],

    saveProduk:      [SH_PRODUK],
    updateProduk:    [SH_PRODUK],
    deleteProduk:    [SH_PRODUK],

    saveTagihan:     [SH_TAGIHAN, SH_KREDIT, SH_PELANGGAN],
    updateTagihan:   [SH_TAGIHAN, SH_KREDIT, SH_PELANGGAN],
    combineTagihan:  [SH_TAGIHAN, SH_KREDIT, SH_PELANGGAN],

    saveStock:       [SH_STOCK],
    addLangsiran:    [SH_LANGSIRAN],
    updateLangsiran: [SH_LANGSIRAN, SH_STOCK],
  };

  var H = {
    saveNota:          handleSaveNota,
    updateNota:        handleUpdateNota,
    savePelanggan:     handleSavePelanggan,
    updatePelanggan:   handleUpdatePelanggan,
    deletePelanggan:   handleDeletePelanggan,
    saveProduk:        handleSaveProduk,
    updateProduk:      handleUpdateProduk,
    deleteProduk:      handleDeleteProduk,
    saveTagihan:       handleSaveTagihan,
    updateTagihan:     handleUpdateTagihan,
    combineTagihan:    handleCombineTagihan,
    saveStock:         handleSaveStock,
    addLangsiran:      handleAddLangsiran,
    updateLangsiran:   handleUpdateLangsiran
  };

  var fn = H[action];
  if (!fn) return _json({ success: false, error: 'Action tidak dikenal: ' + action });

  var out = fn(p);
  if (WRITES[action]) _bustSheets(WRITES[action]);   // dibuang SETELAH tulis selesai
  return out;
}

// ============================================================
//  AUTH
// ============================================================
function handleLogin(e) {
  const uname = (e.parameter.username || '').toLowerCase().trim();
  const pass  = (e.parameter.password || '').trim();

  const sh   = SS.getSheetByName(SH_USERS);
  const data = sh.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const aktif = String(row[8]).toUpperCase();
    if (aktif === 'FALSE') continue;
    if (String(row[2]).toLowerCase() === uname && String(row[3]) === pass) {
      return _json({
        success: true,
        user: {
          id:      String(row[0]),
          nama:    String(row[1]),
          role:    String(row[4]),
          inisial: String(row[5]),
          warna:   String(row[6]),
          bg:      String(row[7]),
        }
      });
    }
  }
  return _json({ success: false, error: 'Username atau password salah.' });
}

// ============================================================
//  PELANGGAN
// ============================================================
function handleGetPelanggan() {
  const sh   = SS.getSheetByName(SH_PELANGGAN);
  const data = sh.getDataRange().getValues();
  const pelanggan = [];

  // Hitung belumTagih & totalBelum dari Data Penjualan + Tagihan
  const { belumMap, totalMap } = _calcBelumTagih();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0] || !row[1]) continue;
    const aktif = String(row[11]).toUpperCase();
    if (aktif === 'FALSE') continue;

    let priceList = [];
    try { priceList = JSON.parse(row[12] || '[]'); } catch(e) { priceList = []; }

    const nama = String(row[1]).trim();
    pelanggan.push({
      id:          String(row[0]),
      nama,
      alias:       String(row[2]  || '').trim(),
      group:       String(row[3]  || '').trim(),
      kota:        String(row[4]  || '').trim(),
      kontak:      String(row[5]  || '').trim(),
      bank:        String(row[6]  || '').trim(),
      norek:       String(row[7]  || '').trim(),
      tujuan:      String(row[8]  || '').trim(),
      ongkir:      row[9]  ? +row[9]  : null,
      kredit:      row[10] ? +row[10] : 0,
      priceList,
      belumTagih:  belumMap[nama]  || 0,
      totalBelum:  totalMap[nama]  || 0,
    });
  }

  return _json({ success: true, pelanggan });
}

function handleSavePelanggan(p) {
  const sh = SS.getSheetByName(SH_PELANGGAN);

  // Generate ID
  const lastRow = sh.getLastRow();
  const id = 'P-' + String(lastRow).padStart(3, '0');

  const priceJson = JSON.stringify(p.priceList || []);
  sh.appendRow([
    id,
    p.nama       || '',
    p.alias      || '',
    p.group      || '',
    p.kota       || '',
    p.kontak     || '',
    p.bank       || '',
    p.norek      || '',
    p.tujuan     || '',
    p.ongkir     || '',
    p.kredit     || 0,
    'TRUE',
    priceJson,
    new Date(),
  ]);

  return _json({ success: true, id });
}

function handleUpdatePelanggan(p) {
  const sh   = SS.getSheetByName(SH_PELANGGAN);
  const data = sh.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(p.id)) continue;

    const row = i + 1;
    const priceJson = JSON.stringify(p.priceList || []);
    sh.getRange(row, 2, 1, 12).setValues([[
      p.nama       || '',
      p.alias      || '',
      p.group      || '',
      p.kota       || '',
      p.kontak     || '',
      p.bank       || '',
      p.norek      || '',
      p.tujuan     || '',
      p.ongkir     || '',
      p.kredit != null ? p.kredit : data[i][10],
      'TRUE',
      priceJson,
    ]]);
    return _json({ success: true });
  }
  return _json({ success: false, error: 'Pelanggan tidak ditemukan.' });
}

function handleDeletePelanggan(p) {
  const sh   = SS.getSheetByName(SH_PELANGGAN);
  const data = sh.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(p.id)) continue;
    // Soft delete — set Aktif = FALSE
    sh.getRange(i + 1, 12).setValue('FALSE');
    return _json({ success: true });
  }
  return _json({ success: false, error: 'Pelanggan tidak ditemukan.' });
}

// ============================================================
//  PRODUK
// ============================================================
function handleGetProduk() {
  const sh   = SS.getSheetByName(SH_PRODUK);
  const data = sh.getDataRange().getValues();
  const produk = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0] || !row[1]) continue;
    const aktif = String(row[5]).toUpperCase();
    if (aktif === 'FALSE') continue;

    let satuanList = [];
    try { satuanList = JSON.parse(row[4] || '[]'); } catch(e) { satuanList = []; }

    produk.push({
      id:        String(row[0]),
      nama:      String(row[1]).trim(),
      alias:     String(row[2] || '').trim(),
      kategori:  String(row[3] || '').trim(),
      satuanList,
    });
  }

  return _json({ success: true, produk });
}

function handleSaveProduk(p) {
  const sh = SS.getSheetByName(SH_PRODUK);

  // Generate ID
  const lastRow = sh.getLastRow();
  const id = 'PRD-' + String(lastRow).padStart(3, '0');

  const satuanJson = JSON.stringify(p.satuanList || []);
  sh.appendRow([
    id,
    (p.nama || '').trim().toUpperCase(),
    p.alias    || '',
    p.kategori || '',
    satuanJson,
    'TRUE',
  ]);

  return _json({ success: true, id });
}

function handleUpdateProduk(p) {
  const sh   = SS.getSheetByName(SH_PRODUK);
  const data = sh.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(p.id)) continue;

    const satuanJson = JSON.stringify(p.satuanList || []);
    sh.getRange(i + 1, 2, 1, 4).setValues([[
      (p.nama || '').trim().toUpperCase(),
      p.alias    || '',
      p.kategori || '',
      satuanJson,
    ]]);
    return _json({ success: true });
  }
  return _json({ success: false, error: 'Produk tidak ditemukan.' });
}

function handleDeleteProduk(p) {
  const sh   = SS.getSheetByName(SH_PRODUK);
  const data = sh.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(p.id)) continue;
    sh.getRange(i + 1, 6).setValue('FALSE');
    return _json({ success: true });
  }
  return _json({ success: false, error: 'Produk tidak ditemukan.' });
}

// ============================================================
//  PENJUALAN (NOTA)
// ============================================================
function handleGetTodayNotas() {
  const sh    = SS.getSheetByName(SH_PENJUALAN);
  const shIt  = SS.getSheetByName(SH_ITEMS);
  const tz    = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const data  = sh.getDataRange().getValues();
  const notas = [];

  // Build items map: idNota → array items
  const itemsMap = _buildItemsMap(shIt);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const rowDate = Utilities.formatDate(new Date(row[1]), tz, 'yyyy-MM-dd');
    if (rowDate !== today) continue;

    const idNota = String(row[0]);
    notas.push({
      idNota,
      nota:       String(row[2]),
      tanggal:    Utilities.formatDate(new Date(row[1]), tz, 'yyyy-MM-dd'),
      client:     row[3],
      alias:      row[4],
      kota:       row[5],
      group:      row[6],
      subtotal:   row[7],
      ong:        row[8],
      ret:        row[9],
      total:      row[10],
      status:     row[11],
      catatan:    row[12],
      itemsArray: itemsMap[idNota] || [],
    });
  }

  var maxNota = 17674;
  for (var k = 1; k < data.length; k++) { var v = +data[k][2] || 0; if (v > maxNota) maxNota = v; }

  return _json({ success: true, notas, nextNota: maxNota + 1 });
}

function handleGetAllNotas() {
  const sh    = SS.getSheetByName(SH_PENJUALAN);
  const shIt  = SS.getSheetByName(SH_ITEMS);
  const tz    = Session.getScriptTimeZone();
  const data  = sh.getDataRange().getValues();
  const notas = [];

  const itemsMap = _buildItemsMap(shIt);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;

    const idNota = String(row[0]);
    notas.push({
      idNota,
      nota:       String(row[2]),
      tanggal:    Utilities.formatDate(new Date(row[1]), tz, 'yyyy-MM-dd'),
      client:     row[3],
      alias:      row[4],
      kota:       row[5],
      group:      row[6],
      subtotal:   row[7],
      ong:        row[8],
      ret:        row[9],
      total:      row[10],
      status:     row[11],
      catatan:    row[12],
      itemsArray: itemsMap[idNota] || [],
    });
  }

  return _json({ success: true, notas });
}

function handleGetNotaBelumTagih() {
  // Nota yang belum masuk tagihan manapun
  const shJ  = SS.getSheetByName(SH_PENJUALAN);
  const shT  = SS.getSheetByName(SH_TAGIHAN);
  const tz   = Session.getScriptTimeZone();

  // Kumpulkan semua ID nota yang sudah ada di tagihan
  const tagData   = shT.getLastRow() > 1 ? shT.getDataRange().getValues() : [[]];
  const taggedIds = new Set();
  for (let i = 1; i < tagData.length; i++) {
    const statusTagihan = String(tagData[i][16] || '');
    // Abaikan tagihan yang dibatalkan (opsional — untuk sekarang semua tagihan block nota)
    let ids = [];
    try { ids = JSON.parse(tagData[i][7] || '[]'); } catch(e) {}
    ids.forEach(id => taggedIds.add(String(id)));
  }

  const data  = shJ.getDataRange().getValues();
  const notas = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const idNota = String(row[0]);
    if (taggedIds.has(idNota)) continue;

    notas.push({
      id:       idNota,
      nota:     String(row[2]),
      tanggal:  Utilities.formatDate(new Date(row[1]), tz, 'yyyy-MM-dd'),
      client:   row[3],
      alias:    row[4],
      kota:     row[5],
      group:    row[6],
      subtotal: row[7],
      ong:      row[8],
      ret:      row[9],
      total:    row[10],
      status:   row[11],
      catatan:  row[12],
      items:    '',
    });
  }

  return _json({ success: true, notas });
}

function handleSaveNota(p) {
  const shJ   = SS.getSheetByName(SH_PENJUALAN);
  const shIt  = SS.getSheetByName(SH_ITEMS);

  const tanggal   = new Date(p.tanggal);
  const tz        = Session.getScriptTimeZone();
  const dateStr   = Utilities.formatDate(tanggal, tz, 'yyyyMMdd');
  const idNota    = dateStr + '-' + String(p.noNota).padStart(4, '0');
  const timestamp = new Date();

  // Tulis ke Data Penjualan
  shJ.appendRow([
    idNota,
    tanggal,
    p.noNota,
    p.nama      || '',
    p.alias     || '',
    p.kota      || '',
    p.group     || '',
    p.subtotal  || 0,
    p.ongkir    || 0,
    p.retur     || 0,
    p.total     || 0,
    p.status    || '',
    p.catatan   || '',
    timestamp,
  ]);

  // Warna baris
  const lastRow = shJ.getLastRow();
  _setStatusColor(shJ, lastRow, 14, p.status);

  // Tulis ke Item Penjualan
  if (Array.isArray(p.items) && p.items.length) {
    const itemRows = p.items
      .filter(it => it.produk && it.produk.trim())
      .map(it => {
        const qty    = +it.qty   || 0;
        const harga  = +it.harga || 0;
        return [idNota, p.noNota, tanggal, p.nama||'', it.produk.trim(), it.satuan||'', qty, harga, qty*harga];
      });
    if (itemRows.length) {
      const startRow = shIt.getLastRow() + 1;
      shIt.getRange(startRow, 1, itemRows.length, 9).setValues(itemRows);
    }
  }

  // Hitung next nota
  const allData = shJ.getRange(2, 3, Math.max(shJ.getLastRow()-1, 1), 1).getValues();
  var maxNota = 0;
  for (var k = 0; k < allData.length; k++) { var v = +allData[k][0] || 0; if (v > maxNota) maxNota = v; }

  return _json({ success: true, idNota, nextNota: maxNota + 1 });
}

function handleUpdateNota(p) {
  const shJ   = SS.getSheetByName(SH_PENJUALAN);
  const data  = shJ.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(p.idNota)) continue;

    const tz      = Session.getScriptTimeZone();
    const tanggal = p.tanggal ? new Date(p.tanggal) : new Date(data[i][1]);
    const ongkir  = p.ong != null ? +p.ong : +p.ongkir || 0;
    const retur   = p.ret != null ? +p.ret : +p.retur  || 0;
    const subtotal = p.subtotal != null ? +p.subtotal : +data[i][7];
    const total    = subtotal + ongkir - retur;

    shJ.getRange(i+1, 2, 1, 12).setValues([[
      tanggal,
      data[i][2],          // No. Nota tidak berubah
      p.nama     || data[i][3],
      p.alias    || data[i][4],
      p.kota     || data[i][5],
      p.group    || data[i][6],
      subtotal,
      ongkir,
      retur,
      total,
      p.status   || data[i][11],
      p.catatan  != null ? p.catatan : data[i][12],
    ]]);

    _setStatusColor(shJ, i+1, 14, p.status || String(data[i][11]));
    return _json({ success: true, total });
  }
  return _json({ success: false, error: 'Nota tidak ditemukan.' });
}

// ============================================================
//  TAGIHAN
// ============================================================
function handleGetTagihan() {
  const sh   = SS.getSheetByName(SH_TAGIHAN);
  const tz   = Session.getScriptTimeZone();
  const data = sh.getDataRange().getValues();
  const tagihan = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;

    let notaIds  = []; try { notaIds  = JSON.parse(row[7]  || '[]'); } catch(e) {}
    let notaList = []; try { notaList = JSON.parse(row[8]  || '[]'); } catch(e) {}
    let bayarRows= []; try { bayarRows= JSON.parse(row[18] || '[]'); } catch(e) {}

    tagihan.push({
      id:             String(row[0]),
      noTagihan:      String(row[1]),
      tanggal:        row[2] ? Utilities.formatDate(new Date(row[2]), tz, 'yyyy-MM-dd') : '',
      client:         row[3],
      alias:          row[4],
      kota:           row[5],
      group:          row[6],
      notaIds,
      notaList,
      notas:          +row[9]  || 0,
      tglAwal:        row[10] ? Utilities.formatDate(new Date(row[10]), tz, 'yyyy-MM-dd') : '',
      tglAkhir:       row[11] ? Utilities.formatDate(new Date(row[11]), tz, 'yyyy-MM-dd') : '',
      totalTagihan:   +row[12] || 0,
      kreditUsed:     +row[13] || 0,
      totalBayar:     +row[14] || 0,
      sisa:           +row[15] || 0,
      status:         row[16],
      catatan:        row[17],
      bayarRows,
    });
  }

  return _json({ success: true, tagihan });
}

function handleSaveTagihan(p) {
  const sh = SS.getSheetByName(SH_TAGIHAN);
  const id = String(p.id || Date.now());
  const ts = new Date();

  sh.appendRow([
    id,
    p.noTagihan      || '',
    p.tanggal        ? new Date(p.tanggal) : ts,
    p.client         || '',
    p.alias          || '',
    p.kota           || '',
    p.group          || '',
    JSON.stringify(p.notaIds   || []),
    JSON.stringify(p.notaList  || []),
    p.notas          || 0,
    p.tglAwal        ? new Date(p.tglAwal)  : '',
    p.tglAkhir       ? new Date(p.tglAkhir) : '',
    p.totalTagihan   || 0,
    p.kreditUsed     || 0,
    p.totalBayar     || 0,
    p.sisa           || 0,
    p.status         || 'PENDING',
    p.catatan        || '',
    JSON.stringify(p.bayarRows || []),
    ts,
  ]);

  // Warna baris
  const lastRow = sh.getLastRow();
  _setStatusColor(sh, lastRow, 20, p.status);

  // Jika ada kelebihan bayar (sisa < 0), simpan ke Kredit
  if ((p.sisa || 0) < 0) {
    _addKredit({
      id:           'k' + Date.now(),
      client:       p.client    || '',
      group:        p.group     || '',
      fromTagihan:  p.noTagihan || '',
      tanggal:      p.tanggal   || new Date(),
      jumlah:       Math.abs(p.sisa),
    });
  }

  // Update kredit pelanggan jika kredit digunakan
  if ((p.kreditUsed || 0) > 0) {
    _updateKreditPelanggan(p.client, -Math.abs(p.kreditUsed));
    _markKreditTerpakai(p.client, p.kreditUsed);
  }

  return _json({ success: true, id });
}

function handleUpdateTagihan(p) {
  const sh   = SS.getSheetByName(SH_TAGIHAN);
  const data = sh.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(p.id)) continue;

    sh.getRange(i+1, 2, 1, 18).setValues([[
      p.noTagihan    || data[i][1],
      p.tanggal      ? new Date(p.tanggal) : new Date(data[i][2]),
      p.client       || data[i][3],
      p.alias        || data[i][4],
      p.kota         || data[i][5],
      p.group        || data[i][6],
      JSON.stringify(p.notaIds  || []),
      JSON.stringify(p.notaList || []),
      p.notas        != null ? p.notas : data[i][9],
      p.tglAwal      ? new Date(p.tglAwal)  : new Date(data[i][10]),
      p.tglAkhir     ? new Date(p.tglAkhir) : new Date(data[i][11]),
      p.totalTagihan != null ? p.totalTagihan : data[i][12],
      p.kreditUsed   != null ? p.kreditUsed   : data[i][13],
      p.totalBayar   != null ? p.totalBayar   : data[i][14],
      p.sisa         != null ? p.sisa         : data[i][15],
      p.status       || data[i][16],
      p.catatan      != null ? p.catatan      : data[i][17],
      JSON.stringify(p.bayarRows || []),
    ]]);

    _setStatusColor(sh, i+1, 20, p.status || String(data[i][16]));
    return _json({ success: true });
  }
  return _json({ success: false, error: 'Tagihan tidak ditemukan.' });
}

function handleCombineTagihan(p) {
  const sh   = SS.getSheetByName(SH_TAGIHAN);
  const data = sh.getDataRange().getValues();

  // Hapus tagihan lama yang digabung (set baris kosong / soft delete tidak didukung mermaid)
  // Implementasi: hapus baris dari bawah ke atas untuk menghindari index shift
  const removedIds = new Set(p.removedIds || []);
  const rowsToDelete = [];

  for (let i = 1; i < data.length; i++) {
    if (removedIds.has(String(data[i][0]))) {
      rowsToDelete.push(i + 1); // 1-based
    }
  }

  // Hapus dari bawah ke atas
  rowsToDelete.sort((a,b) => b-a).forEach(r => sh.deleteRow(r));

  // Simpan tagihan gabungan baru
  return handleSaveTagihan(p);
}

// ============================================================
//  KREDIT
// ============================================================
function handleGetKredit() {
  const sh   = SS.getSheetByName(SH_KREDIT);
  const tz   = Session.getScriptTimeZone();
  const data = sh.getDataRange().getValues();
  const kredit = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const terpakai = String(row[6]).toUpperCase() === 'TRUE';

    kredit.push({
      id:           String(row[0]),
      client:       row[1],
      group:        row[2],
      fromTagihan:  row[3],
      tanggal:      row[4] ? Utilities.formatDate(new Date(row[4]), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
      jumlah:       +row[5] || 0,
      terpakai,
    });
  }

  return _json({ success: true, kredit });
}

function _addKredit(k) {
  const sh = SS.getSheetByName(SH_KREDIT);
  sh.appendRow([
    k.id,
    k.client      || '',
    k.group       || '',
    k.fromTagihan || '',
    k.tanggal     ? new Date(k.tanggal) : new Date(),
    k.jumlah      || 0,
    'FALSE',
  ]);
  sh.getRange(sh.getLastRow(), 1, 1, 7).setBackground(CLR_KREDIT);

  // Update kredit balance di sheet Pelanggan
  _updateKreditPelanggan(k.client, k.jumlah);
}

function _updateKreditPelanggan(namaPelanggan, delta) {
  const sh   = SS.getSheetByName(SH_PELANGGAN);
  const data = sh.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim().toUpperCase() === String(namaPelanggan).trim().toUpperCase()) {
      const current = +data[i][10] || 0;
      sh.getRange(i+1, 11).setValue(current + delta);
      return;
    }
  }
}

function _markKreditTerpakai(namaPelanggan, jumlah) {
  const sh   = SS.getSheetByName(SH_KREDIT);
  const data = sh.getDataRange().getValues();
  let remaining = jumlah;

  for (let i = 1; i < data.length; i++) {
    if (remaining <= 0) break;
    if (String(data[i][1]).trim().toUpperCase() !== String(namaPelanggan).trim().toUpperCase()) continue;
    if (String(data[i][6]).toUpperCase() === 'TRUE') continue;

    sh.getRange(i+1, 7).setValue('TRUE');
    remaining -= (+data[i][5] || 0);
  }
}

// ============================================================
//  LANGSIRAN
// ============================================================
function handleGetLangsiran() {
  const sh   = SS.getSheetByName(SH_LANGSIRAN);
  const tz   = Session.getScriptTimeZone();
  const data = sh.getDataRange().getValues();
  const langsiran = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;

    let items = [];
    try { items = JSON.parse(row[6] || '[]'); } catch(e) {}

    langsiran.push({
      id:              String(row[0]),
      tanggal:         row[1] ? Utilities.formatDate(new Date(row[1]), tz, 'yyyy-MM-dd') : '',
      waktu_kirim:     row[2],
      plat:            row[3],
      supir:           row[4],
      status:          row[5],
      items,
      catatan_kirim:   row[7],
      waktu_datang:    row[8],
      catatan_terima:  row[9],
      input_kirim:     row[10],
      input_terima:    row[11],
    });
  }

  return _json({ success: true, langsiran });
}

function handleAddLangsiran(p) {
  const sh = SS.getSheetByName(SH_LANGSIRAN);
  const ts = new Date();

  // Generate ID: LNG-YYYYMMDD-XXX
  const tz    = Session.getScriptTimeZone();
  const today = Utilities.formatDate(ts, tz, 'yyyyMMdd');
  const lastRow = sh.getLastRow();
  const id = p.id || ('LNG-' + today + '-' + String(lastRow).padStart(3,'0'));

  sh.appendRow([
    id,
    p.tanggal ? new Date(p.tanggal) : ts,
    p.waktu_kirim    || '',
    p.plat           || '',
    p.supir          || '',
    p.status         || 'DIKIRIM',
    JSON.stringify(p.items || []),
    p.catatan_kirim  || '',
    p.waktu_datang   || '',
    p.catatan_terima || '',
    p.input_kirim    || '',
    p.input_terima   || '',
    ts,
  ]);

  return _json({ success: true, id });
}

function handleUpdateLangsiran(p) {
  const sh   = SS.getSheetByName(SH_LANGSIRAN);
  const data = sh.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(p.id)) continue;

    // Partial update — hanya field yang dikirim
    const row = i + 1;
    if (p.status        != null) sh.getRange(row, 6).setValue(p.status);
    if (p.waktu_datang  != null) sh.getRange(row, 9).setValue(p.waktu_datang);
    if (p.catatan_terima!= null) sh.getRange(row,10).setValue(p.catatan_terima);
    if (p.input_terima  != null) sh.getRange(row,12).setValue(p.input_terima);
    if (p.catatan_kirim != null) sh.getRange(row, 8).setValue(p.catatan_kirim);
    if (p.items         != null) sh.getRange(row, 7).setValue(JSON.stringify(p.items));

    return _json({ success: true });
  }
  return _json({ success: false, error: 'Langsiran tidak ditemukan.' });
}

// ============================================================
//  STOCK
// ============================================================
function handleGetStock() {
  const sh   = SS.getSheetByName(SH_STOCK);
  const tz   = Session.getScriptTimeZone();
  const data = sh.getDataRange().getValues();
  const stock = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;

    stock.push({
      id:       String(row[0]),
      tanggal:  row[1] ? Utilities.formatDate(new Date(row[1]), tz, 'yyyy-MM-dd') : '',
      produk:   row[2],
      satuan:   row[3],
      qty:      +row[4] || 0,
      catatan:  row[5],
      input_by: row[6],
    });
  }

  return _json({ success: true, stock });
}

function handleSaveStock(p) {
  const sh = SS.getSheetByName(SH_STOCK);
  const tz = Session.getScriptTimeZone();
  const ts = new Date();

  const entries = p.entries || [];
  const saved = [];

  entries.forEach(e => {
    const tgl = e.tanggal ? new Date(e.tanggal) : ts;
    const tglStr = Utilities.formatDate(tgl, tz, 'yyyy-MM-dd');

    // Cek apakah sudah ada data untuk tanggal + produk + satuan yang sama
    const data = sh.getDataRange().getValues();
    let found = false;

    for (let i = 1; i < data.length; i++) {
      const rowTgl = data[i][1] ? Utilities.formatDate(new Date(data[i][1]), tz, 'yyyy-MM-dd') : '';
      if (rowTgl === tglStr && String(data[i][2]) === String(e.produk) && String(data[i][3]) === String(e.satuan)) {
        // Update qty
        sh.getRange(i+1, 5, 1, 3).setValues([[e.qty || 0, e.catatan || '', e.input_by || '']]);
        found = true;
        saved.push({ ...e, tanggal: tglStr });
        break;
      }
    }

    if (!found) {
      const id = 'STK-' + Date.now() + '-' + Math.floor(Math.random()*1000);
      sh.appendRow([id, tgl, e.produk||'', e.satuan||'', e.qty||0, e.catatan||'', e.input_by||'', ts]);
      saved.push({ ...e, id, tanggal: tglStr });
    }
  });

  return _json({ success: true, saved });
}

// ============================================================
//  HELPERS
// ============================================================

// Buat sheet baru atau ambil yang sudah ada
function _getOrCreate(name) {
  return SS.getSheetByName(name) || SS.insertSheet(name);
}

// Format baris header
function _formatHeader(sheet, numCols) {
  const range = sheet.getRange(1, 1, 1, numCols);
  range.setFontWeight('bold')
       .setBackground(CLR_HEADER)
       .setFontColor(CLR_WHITE)
       .setFontSize(10)
       .setVerticalAlignment('middle')
       .setHorizontalAlignment('left');
  sheet.setRowHeight(1, 36);
}

// Set warna baris berdasarkan status
function _setStatusColor(sheet, row, numCols, status) {
  const range = sheet.getRange(row, 1, 1, numCols);
  if      (status === 'LUNAS')     range.setBackground(CLR_LUNAS);
  else if (status === 'PENDING')   range.setBackground(CLR_PENDING);
  else if (status === 'TTP')       range.setBackground(CLR_TTP);
  else if (status === 'KELEBIHAN') range.setBackground(CLR_KREDIT);
  else                             range.setBackground(CLR_WHITE);
}

// Build map idNota → [{produk, satuan, qty, harga, jumlah}]
function _buildItemsMap(shItems) {
  const map  = {};
  const data = shItems.getLastRow() > 1 ? shItems.getDataRange().getValues() : [[]];

  for (let i = 1; i < data.length; i++) {
    const row    = data[i];
    const idNota = String(row[0]);
    if (!idNota) continue;
    if (!map[idNota]) map[idNota] = [];
    map[idNota].push({
      produk: row[4],
      satuan: row[5],
      qty:    +row[6] || 0,
      harga:  +row[7] || 0,
      jumlah: +row[8] || 0,
    });
  }
  return map;
}

// Hitung jumlah nota & total yang belum ada di tagihan per pelanggan
function _calcBelumTagih() {
  const shJ = SS.getSheetByName(SH_PENJUALAN);
  const shT = SS.getSheetByName(SH_TAGIHAN);

  const tagData = shT.getLastRow() > 1 ? shT.getDataRange().getValues() : [[]];
  const taggedIds = new Set();
  for (let i = 1; i < tagData.length; i++) {
    let ids = [];
    try { ids = JSON.parse(tagData[i][7] || '[]'); } catch(e) {}
    ids.forEach(id => taggedIds.add(String(id)));
  }

  const jualData = shJ.getLastRow() > 1 ? shJ.getDataRange().getValues() : [[]];
  const belumMap  = {};
  const totalMap  = {};

  for (let i = 1; i < jualData.length; i++) {
    const row    = jualData[i];
    const idNota = String(row[0]);
    if (!idNota || taggedIds.has(idNota)) continue;

    const nama = String(row[3] || '').trim();
    if (!nama) continue;

    belumMap[nama]  = (belumMap[nama]  || 0) + 1;
    totalMap[nama]  = (totalMap[nama]  || 0) + (+row[10] || 0);
  }

  return { belumMap, totalMap };
}

// Output JSON
function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
