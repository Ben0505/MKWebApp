/* ============================================================
   mk-toast.js — Pesan pemberitahuan sebagai baris di bawah layar
   ------------------------------------------------------------
   Pasang PALING AKHIR di setiap halaman, setelah skrip halaman:

     <script src="mk-responsive.js"></script>
     <script src="mk-toast.js"></script>     <-- ini

   ============================================================
   KENAPA BERKAS INI ADA

   1. Pesan lama saling menimpa dengan bilah status.
      Kartu pesan memakai bottom:22px dengan z-index:999,
      sedangkan bilah status setinggi 34px dengan z-index:10000.
      Jadi bagian bawah setiap pesan tertutup bilah status —
      terlihat jelas di layar besar maupun HP. Sekarang keduanya
      bertumpuk rapi: pesan tepat DI ATAS bilah status.

   2. Pesan gagal terlalu cepat hilang.
      "Simpan gagal" dulu menghilang setelah 2,8 detik sama persis
      seperti pesan berhasil. Sekarang keduanya tetap hilang
      sendiri, tapi pesan gagal diberi waktu baca sedikit lebih
      lama, dan warnanya merah, bukan hijau. Menyentuh barisnya
      menutup lebih cepat.

   3. data-penjualan.html selalu memakai kelas 'ok'.
      showToast(msg) di sana menulis el.className='toast ok'
      tanpa memeriksa argumen kedua, padahal dipanggil dengan
      showToast('⚠ Update gagal: ...', false). Jadi pesan gagal
      di halaman itu tampil hijau seperti berhasil.

   ============================================================
   CARA KERJA

   Semua halaman mendefinisikan showToast() atau toast() sebagai
   fungsi tingkat atas, sehingga keduanya ada di window. Berkas
   ini dimuat SETELAH skrip halaman, lalu menggantikan keduanya.
   Titik pemanggilan di halaman tidak perlu diubah sama sekali —
   showToast('✓ Nota diperbarui') tetap ditulis seperti biasa.

   Aturan tampilan memakai pemilih #toast (id), sedangkan aturan
   lama memakai .toast (kelas). Id menang atas kelas, jadi gaya
   lama tidak perlu dihapus dari kedelapan halaman.

   Menghapus satu baris <script> mengembalikan perilaku lama.
   ============================================================ */
(function () {
  'use strict';

  /* Keduanya hilang sendiri. Pesan gagal diberi sedikit lebih lama
     karena biasanya lebih panjang dan perlu dibaca sampai habis. */
  var OK_MS  = 3200;
  var ERR_MS = 4000;
  var timer = null;

  /* Kata-kata yang menandakan kegagalan. Diperlukan karena
     sebagian halaman memanggil toast(pesan) tanpa argumen
     penanda berhasil/gagal, jadi satu-satunya petunjuk adalah
     isi pesannya sendiri. */
  var ERR_RE = /⚠|✕|✗|gagal|error|tidak bisa|tidak dapat|belum|wajib|minimal|harus|invalid|salah/i;

  function isError(msg, ok) {
    if (ok === false) return true;      // dinyatakan tegas sebagai gagal
    if (ok === true)  return false;     // dinyatakan tegas sebagai berhasil
    return ERR_RE.test(String(msg || ''));
  }

  function ensureCSS() {
    if (document.getElementById('mk-toast-css')) return;
    var s = document.createElement('style');
    s.id = 'mk-toast-css';
    s.textContent = [
      /* Setiap sifat yang ditetapkan aturan .toast lama ditimpa di
         sini, termasuk yang hanya dipakai sebagian halaman:
         left/right (versi pojok kanan), white-space:nowrap dan
         border-radius:999px (versi pil tengah). */
      '#toast{',
      '  position:fixed; left:0; right:0; bottom:0; z-index:10001;',
      '  display:flex; align-items:center; gap:10px;',
      '  min-height:36px; padding:8px 12px 8px 14px;',
      '  box-sizing:border-box; text-align:left; white-space:normal;',
      '  max-width:none; width:auto;',
      '  font-family:var(--sans,"DM Sans",sans-serif);',
      '  font-size:13.5px; font-weight:500; line-height:1.35;',
      '  border:none; border-top:1px solid transparent;',
      '  border-radius:0; box-shadow:none;',
      /* Mulai tersembunyi DI BALIK bilah status, lalu naik. */
      '  transform:translateY(100%); opacity:0; pointer-events:none;',
      '  transition:transform .22s ease, opacity .22s ease;',
      '}',
      '#toast.show{transform:translateY(0); opacity:1; pointer-events:auto; cursor:pointer;}',

      /* Berhasil — hijau, sama dengan palet bilah status */
      '#toast.ok{background:#EDF6F1; border-top-color:#C9E3D6; color:#14603D;}',
      /* Gagal — merah */
      '#toast.err{background:#FDECEC; border-top-color:#F2C7C7; color:#A62B0D;}',

      '#toast .mk-t-msg{flex:1; min-width:0; overflow-wrap:break-word;}',

      /* Sejajar dengan bilah status: ikut menyingkir dari sidebar */
      '@media(min-width:1024px){#toast{left:var(--sb-full,210px);}}',
      '@media(min-width:640px) and (max-width:1023px){#toast{left:var(--sb-icon,60px);}}',

      '@media(prefers-reduced-motion:reduce){#toast{transition:none;}}',
      '@media print{#toast{display:none!important;}}',
    ].join('\n');
    document.head.appendChild(s);
  }

  function node() {
    if (!document.body) return null;
    ensureCSS();
    var t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    if (!t.querySelector('.mk-t-msg')) {
      t.textContent = '';
      var m = document.createElement('span'); m.className = 'mk-t-msg';
      t.appendChild(m);
      /* Tidak ada tombol tutup: pesannya memang hilang sendiri.
         Menyentuh barisnya menutup lebih cepat kalau menghalangi. */
      t.addEventListener('click', hide);
    }
    /* Pembaca layar mengumumkan isinya saat berubah. */
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    return t;
  }

  /* Duduk tepat di atas bilah status. Tingginya diukur langsung,
     bukan ditulis ulang sebagai angka tetap, supaya tetap benar
     kalau bilah itu berubah tinggi — misalnya karena area aman
     di iPhone. Kalau bilahnya tidak ada, menempel ke dasar. */
  function position(t) {
    var bar = document.getElementById('mk-net-bar');
    t.style.bottom = bar ? Math.round(bar.getBoundingClientRect().height) + 'px' : '0px';
  }

  function hide() {
    var t = document.getElementById('toast');
    if (t) t.classList.remove('show');
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function show(msg, ok) {
    var t = node();
    if (!t) return;

    var err = isError(msg, ok);
    t.querySelector('.mk-t-msg').textContent = String(msg == null ? '' : msg);
    t.className = 'toast ' + (err ? 'err' : 'ok');
    position(t);

    /* Paksa reflow supaya animasi naik tetap jalan untuk pesan
       yang datang berturut-turut. */
    void t.offsetWidth;
    t.classList.add('show');

    if (timer) { clearTimeout(timer); timer = null; }
    timer = setTimeout(hide, err ? ERR_MS : OK_MS);
  }

  /* Titik pemanggilan halaman tidak berubah. Kedua nama dipakai:
     showToast() di lima halaman, toast() di tiga halaman. */
  window.showToast = function (msg, ok) { show(msg, ok); };
  window.toast     = function (msg, ok) { show(msg, ok); };
  window.MK_TOAST  = { show: show, hide: hide };

  /* Bilah status bisa berubah tinggi saat layar diputar. */
  window.addEventListener('resize', function () {
    var t = document.getElementById('toast');
    if (t && t.classList.contains('show')) position(t);
  });
})();
