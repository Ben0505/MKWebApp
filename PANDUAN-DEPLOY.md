# BUKU MK v2 — Panduan Deployment Uji Coba

---

## 1. Apakah struktur database berubah?

**Tidak. Nol perubahan.**

Ini bukan jawaban sopan — ini hasil pemeriksaan. Rinciannya:

| Hal | Berubah? | Keterangan |
|---|---|---|
| Nama sheet (9 buah) | ❌ | Tidak disentuh |
| Kolom / header | ❌ | Tidak ada yang ditambah, dihapus, atau digeser |
| Urutan kolom | ❌ | Semua indeks `row[0]`…`row[12]` tetap sama |
| Format tanggal & angka | ❌ | Tidak disentuh |
| Isi data | ❌ | Tidak ada migrasi, tidak ada penulisan ulang |
| Fungsi `setupAll()` | ❌ | Tidak dijalankan lagi — jangan dijalankan |

Semua fitur baru di backend memakai **CacheService** — memori sementara milik
Google Apps Script, terpisah total dari spreadsheet. Kunci dedupe `clientRef`
juga disimpan di sana, bukan di sheet.

**Artinya:** sheet lama dan sheet baru punya struktur identik. Kalau v2 gagal,
Anda bisa mengarahkan `mk-config.js` kembali ke deployment lama dan semuanya
langsung jalan. Bahkan bisa menjalankan Code.gs v1 dan v2 di atas sheet yang
sama tanpa konflik.

**Satu-satunya yang saya ubah dan perlu Anda tahu:**
`login.html` tidak lagi punya daftar username/password di dalam file JavaScript.
Login sekarang **sepenuhnya** bergantung pada sheet **Users**. Pastikan sheet
Users di salinan Anda berisi user yang benar (kolom `Aktif` = TRUE), karena
tidak ada lagi jalan pintas kalau GAS gagal dihubungi.

---

## 2. Daftar file untuk deployment baru

Unggah **15 file** ini ke root Cloudflare Pages. Rata — tanpa subfolder.

### Baru (4)
| File | Fungsi |
|---|---|
| `mk-config.js` | **Satu-satunya file yang perlu Anda edit.** URL GAS + label lingkungan |
| `mk-net.js` | Lapisan jaringan: cache tahan-lama, stale-while-revalidate, timeout, retry |
| `mk-responsive.css` | Lapisan adaptif: tablet & HP |
| `mk-responsive.js` | Pendamping CSS di atas (mengubah tabel jadi kartu di HP) |

### Diubah (12)
| File | Yang berubah |
|---|---|
| `auth.js` | Sesi pindah ke localStorage + masa berlaku; label lingkungan di sidebar |
| `login.html` | Password plaintext & mock fallback **dihapus**; sesi 8 jam; pesan error jelas |
| `input-penjualan.html` | `bust('getPelanggan')` per-load dihapus + tag baru |
| `data-penjualan.html` | Tag baru + URL GAS dari config |
| `tagihan.html` | Tag baru + URL GAS dari config |
| `pelanggan.html` | Tag baru + URL GAS dari config |
| `produk.html` | Tag baru + URL GAS dari config |
| `langsiran.html` | Tag baru + URL GAS dari config |
| `stock.html` | Tag baru + URL GAS dari config |
| `ringkasan.html` | Tag baru + URL GAS dari config |
| `stats.html` | Tag baru + URL GAS dari config |
| `index.html` | Tidak berubah (hanya redirect) — tetap diunggah |

### Tidak diubah (1)
`nav.css` — tetap diunggah apa adanya.

### **Tidak** disertakan (sengaja)
`input-penjualan-mobile.html` dan `pelanggan-mobile.html`.

Kedua file itu **yatim** — tidak ada satu pun link yang menuju ke sana, dan
tidak ada deteksi perangkat di `login.html`. Selama ini tidak pernah benar-benar
terpakai. Menyertakannya di deployment uji coba justru merusak tujuan pengujian:
kita ingin tahu **apakah pendekatan satu-file-adaptif sudah cukup baik**.
Kalau keduanya ikut, Anda tidak bisa menilai.

Deployment lama tetap menyimpan file-file itu. Jadi Anda punya perbandingan A/B
yang sebenarnya.

### Backend (1) — bukan ke Cloudflare
`Code.gs` → tempel ke Apps Script di **sheet salinan**, lalu deploy.

---

## 3. Langkah pemasangan

**A. Salin spreadsheet**
`File → Make a copy`. Beri nama misalnya *BUKU MK - Web (UJI COBA)*.

> ⚠ **Jangan jalankan `setupAll()`.** Fungsi itu untuk sheet kosong. Menjalankannya
> di sheet berisi data tidak akan menghapus apa pun (ada penjaga `if (sh.getLastRow() > 0) return`),
> tapi tidak ada gunanya juga. Lewati saja.

**B. Pasang backend**
Di sheet salinan: `Extensions → Apps Script`. Hapus semua isi, tempel `Code.gs` yang baru.
Lalu `Deploy → New deployment → Web app`:
- Execute as: **Me**
- Who has access: **Anyone**

Salin URL yang berakhiran `/exec`.

**C. Isi konfigurasi**
Buka `mk-config.js`, ganti satu baris:
```js
GAS: 'https://script.google.com/macros/s/AKfycb.....BARU...../exec',
```
Ini satu-satunya tempat. Dulu URL ini tersebar di 12 file — sekarang terpusat.

**D. Unggah ke Cloudflare Pages**
Buat project baru, unggah ke-15 file. Tunggu deploy selesai.

**E. Verifikasi (5 menit)**
1. Buka URL baru → login. Kalau muncul *"Tidak bisa terhubung ke server"*,
   berarti URL GAS di `mk-config.js` salah.
2. Lihat pojok bawah sidebar → harus ada tulisan oranye **UJI COBA**.
   Ini pengaman supaya Anda tidak salah memasukkan data ke versi uji.
3. Buka DevTools → Application → Local Storage → harus ada kunci `mkc2_*`.
4. Muat ulang halaman → harus **instan**, tanpa spinner.
5. DevTools → Network → set **Slow 3G** → pindah-pindah halaman.
   Dropdown pelanggan harus tetap terisi.
6. Set **Offline** → muat ulang → harus muncul banner merah
   *"Offline — menampilkan data tersimpan"*, dan data lama tetap tampil.
7. Buka di HP → tabel harus tampil sebagai kartu, bukan geser samping.

---

## 4. Yang sudah diuji vs yang belum

Saya jalankan pengujian browser sungguhan (Chromium headless) terhadap file-file ini.

**Sudah diverifikasi:**

| Uji | Hasil |
|---|---|
| Ambil pertama (cache kosong) | 14 ms, satu permintaan |
| Ambil kedua (cache segar) | **0 ms, nol permintaan jaringan** |
| Cache basi | data lama tampil **0 ms**, versi baru masuk di latar belakang |
| Jaringan mati + cache basi | data tetap tampil, dropdown tidak kosong |
| Jaringan mati setelah simpan | mundur ke cache, tidak layar kosong |
| Banner offline | tampil: *"⚠ Offline — menampilkan data tersimpan"* |
| Tabel di 390px (HP) | jadi kartu, label kolom benar, **tanpa scroll horizontal** |
| Tabel di 820px (tablet) | tetap tabel |
| Tabel di 1440px (desktop) | tetap tabel — **desktop tidak berubah sama sekali** |
| Tabel di-render ulang oleh JS | label terpasang lagi otomatis (MutationObserver) |
| Sintaks semua file JS + Code.gs | lulus |
| Urutan tag di 12 halaman | lulus (config → auth → net) |

**Belum diuji — ini yang harus Anda periksa:**

- Semua alur tulis terhadap Google Sheet sungguhan (saya pakai server tiruan)
- Cetak nota & cetak harian — CSS cetak saya tambahkan untuk menyembunyikan
  banner jaringan, tapi **wajib dicek langsung**
- Logika kredit & grouping di `tagihan.html` — tidak saya sentuh, tapi halaman
  itu paling rumit dan pantas diuji ulang
- Tampilan tiap halaman di tablet asli. Ini justru inti pengujiannya.

---

## 5. Apa yang berubah dari sisi rasa pemakaian

| Situasi | Sebelum | Sesudah |
|---|---|---|
| Buka halaman pertama kali | 2–4 dtk (cold start GAS) | Sama — ini batas Apps Script |
| Buka halaman kedua kalinya | Sering ambil ulang | Instan |
| Pindah aplikasi lalu kembali | **Ambil ulang semua** | Instan, refresh diam-diam |
| Tutup tab lalu buka lagi | Cache hilang + **login ulang** | Cache utuh, sesi 8 jam |
| Internet lemot | Dropdown kosong, tanpa pesan | Data lama tampil, banner muncul |
| Internet mati | Layar kosong senyap | Data tersimpan tampil + banner merah |
| Simpan gagal | Nota hilang | Diulang otomatis 2×, aman dari duplikat |
| Dua orang simpan bersamaan | Bisa rebutan nomor nota | Dikunci di server |
| Buka di HP | Tabel meluber ke samping | Tabel jadi kartu |

Satu kondisi yang **tetap gagal**, dan saya tidak akan menutupinya:
**perangkat baru + internet mati + belum pernah membuka aplikasi = tidak bisa apa-apa.**
Tidak ada cache untuk dijadikan cadangan. Memperbaiki ini butuh Service Worker,
dan itu proyek tersendiri.

---

## 6. Cara mundur kalau gagal

Deployment lama tidak disentuh sama sekali. Kalau ada masalah, cukup pakai
URL Cloudflare yang lama. Tidak ada yang perlu dibatalkan, tidak ada data yang
perlu dipulihkan.

Kalau hanya **satu halaman** yang bermasalah di HP, jangan buang seluruh v2 —
tambahkan `class="mk-keep-table"` pada tabel di halaman itu, dan tabelnya
kembali ke mode geser-samping seperti semula.

---

## 7. Yang sengaja saya tinggalkan

Supaya jelas apa yang **belum** dikerjakan:

1. **Autosave draft nota** — nota setengah jadi masih hilang kalau halaman
   ter-refresh. Ini prioritas nomor satu saya berikutnya, tapi butuh perubahan
   khusus di `input-penjualan.html` dan saya tidak mau menyelipkan kode yang
   belum teruji ke dalam paket "tinggal pasang".
2. **Otorisasi peran di sisi server** — user `produksi` masih bisa memanggil
   `deletePelanggan` lewat console browser. Ini butuh token dan perubahan di
   setiap halaman. Kerjakan setelah v2 terbukti stabil.
3. **Batas rentang tanggal `getAllNotas`** — saya siapkan rancangannya tapi
   tidak dipasang. Alasannya jujur: itu mengubah data yang diterima setiap
   halaman, dan mencampurnya dengan perubahan jaringan membuat pengujian jadi
   sulit dibaca kalau ada yang salah. Kerjakan sebagai v2.1 tersendiri.
   Hari ini payload Anda masih wajar; ini asuransi untuk 18 bulan ke depan.
