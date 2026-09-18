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
