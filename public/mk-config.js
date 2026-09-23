/* ============================================================
   mk-config.js — Konfigurasi pusat BUKU MK
   ------------------------------------------------------------
   ⚠ INI SATU-SATUNYA FILE YANG PERLU DIUBAH saat ganti deployment.
   Dulu URL GAS ditulis ulang di 12 file berbeda — sekarang cuma di sini.

   Cara pakai:
   1. Duplikat Google Sheet lama (File → Make a copy)
   2. Di sheet BARU: Extensions → Apps Script → paste Code.gs baru
   3. Deploy → New deployment → Web app
        Execute as     : Me
        Who has access : Anyone
   4. Salin URL /exec-nya, tempel di GAS di bawah ini
   ============================================================ */
const MK_CONFIG = {

  /* ── URL deployment Apps Script (WAJIB DIGANTI) ─────────── */
  GAS: 'https://script.google.com/macros/s/AKfycbxMsghq6dlBhXUrI39FO6k2Ici4EqmLpInBTYFOTEjhv9Hc0F3cnMfN0idWtKbQ0o3cig/exec',

  /* ── Label lingkungan — muncul di pojok sidebar ──────────
     Isi '' untuk menyembunyikan. Berguna supaya tidak tertukar
     antara deployment lama dan baru saat pengujian.          */
  ENV_LABEL: 'UJI COBA',

  /* ── Apakah Code.gs di server sudah punya getNotasRange ───
     false = halaman Data Penjualan mengambil seluruh riwayat satu
             kali lalu menyaringnya di browser. Ini perilaku yang
             sudah terbukti jalan sejak dulu.
     true  = halaman itu mengambil per rentang tanggal saja, jauh
             lebih ringan.

     BIARKAN false sampai Code.gs benar-benar dideploy ulang.

     Cara memastikan sebelum mengubahnya: buka URL GAS di atas pada
     peramban, tambahkan di belakangnya

       ?action=getNotasRange&dari=2026-09-01&sampai=2026-09-07

     Kalau jawabannya {"success":true,...} → boleh diisi true.
     Kalau {"status":"ok","message":"BUKU MK API aktif."} → belum
     dideploy, biarkan false.

     Sengaja berupa saklar, bukan deteksi otomatis. Deteksi otomatis
     berarti setiap kali halaman dibuka ada satu permintaan yang
     memang akan gagal, lalu jalur cadangan yang dijalankan sesudah
     kegagalan itu — jalur yang paling jarang dilewati, dan paling
     mudah salah. Itulah yang membuat halaman ini rusak.          */
  RANGE_API: false,

  /* ── Berapa lama sesi login bertahan (jam) ───────────────
     Dulu pakai sessionStorage → logout tiap kali tab ditutup.
     8 jam = satu kali login per hari kerja.                  */
  SESSION_HOURS: 8,

  /* ── Versi bundle, untuk memastikan cache browser ter-refresh ── */
  VERSION: '2.1.0',
};

/* Peringatan dini kalau URL belum diganti */
if (MK_CONFIG.GAS.indexOf('script.google.com') === -1) {
  console.error('[mk-config] URL GAS belum diisi! Buka mk-config.js dan ganti nilai GAS.');
}
