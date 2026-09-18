/* ============================================================
   mk-responsive.js — pendamping mk-responsive.css
   ------------------------------------------------------------
   Pasang paling akhir, sebelum </body>:
     <link rel="stylesheet" href="mk-responsive.css">
     ...
     <script src="mk-responsive.js"></script>

   Tugasnya cuma satu: menyalin teks <th> ke atribut data-label
   di tiap <td>, supaya CSS bisa mengubah tabel jadi kartu di HP.
   Bekerja juga untuk tabel yang di-render ulang oleh JS
   (pakai MutationObserver).

   Ingin sebuah tabel TIDAK diubah jadi kartu (mis. tabel input
   item atau tabel cetak nota)? Tambahkan class="mk-keep-table".
   ============================================================ */
(function () {
  'use strict';

  const SKIP = 'mk-keep-table';

  function labelTable(tbl) {
    if (!tbl || tbl.classList.contains(SKIP)) return;

    const heads = Array.from(tbl.querySelectorAll('thead th'))
      .map(th => (th.textContent || '').trim());

    // Tanpa <thead> tabel tidak bisa dilabeli — biarkan digeser horizontal saja
    if (!heads.length) return;
    tbl.classList.add('mk-cards');

    tbl.querySelectorAll('tbody tr').forEach(tr => {
      Array.from(tr.children).forEach((td, i) => {
        if (td.tagName !== 'TD') return;

        const label = heads[i] || '';
        td.setAttribute('data-label', label);

        const txt = (td.textContent || '').trim();
        const hasCtl = td.querySelector('button,a,input,select,.btn,svg');

        // Kolom pertama = judul kartu
        td.classList.toggle('mk-title', i === 0 && !hasCtl);

        // Kolom aksi = kolom terakhir yang isinya tombol, atau header kosong/"Aksi"
        const isAction = !!hasCtl &&
          (i === heads.length - 1 || /^(aksi|action|opsi|)$/i.test(label));
        td.classList.toggle('mk-actions', isAction);

        // Sel kosong disembunyikan supaya kartu tetap ringkas
        td.classList.toggle('mk-empty',
          !hasCtl && (txt === '' || txt === '—' || txt === '-'));
      });
    });
  }

  function labelAll(root) {
    (root || document).querySelectorAll('table').forEach(labelTable);
  }

  let pending = null;
  function scheduleLabel() {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = null; labelAll(); });
  }

  function start() {
    labelAll();

    // Halaman ini me-render ulang <tbody> lewat innerHTML setelah fetch,
    // jadi label harus dipasang ulang tiap kali isi tabel berubah.
    const mo = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'childList' && m.addedNodes.length) { scheduleLabel(); return; }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // Orientasi berubah (HP diputar) → hitung ulang
    window.addEventListener('orientationchange', scheduleLabel);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.MK_RESPONSIVE = { relabel: labelAll };
})();
