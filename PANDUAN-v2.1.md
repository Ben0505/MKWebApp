# BUKU MK v2.1 — Perbaikan Kecepatan & Tampilan HP

Lanjutan dari `PANDUAN-DEPLOY.md` (v2). Dokumen ini hanya membahas apa yang
berubah di v2.1 dan apa yang harus Anda lakukan.

Dua keluhan yang dikerjakan:

1. Tampilan di HP kurang bagus.
2. Memuat data sering lambat.

Keduanya ternyata punya sebab yang jelas dan bisa ditunjukkan, bukan sekadar
"perlu dioptimalkan".

---

## 1. Apakah struktur database berubah?

**Tidak. Nol perubahan.** Sama seperti v2.

Tidak ada nama sheet, kolom, urutan kolom, format, atau isi data yang disentuh.
Semua perbaikan ada di lapisan jaringan, cache (CacheService — memori Google,
bukan spreadsheet), dan CSS.

`setupAll()` tetap **tidak perlu** dan **jangan** dijalankan.

---

## 2. Kenapa HP terasa rusak — sebab sebenarnya

Bukan karena tata letaknya kurang rapi. Karena **sebagian halaman terpotong
dan tidak bisa dijangkau sama sekali.**

Yang saya ukur di layar 390px (iPhone) pada versi lama:

| Halaman | Lebar isi | Lebar layar | Terpotong |
|---|---|---|---|
| input-penjualan | 712px | 390px | **322px** |
| data-penjualan (tablet 820px) | 1022px | 820px | **262px** |
| langsiran | 443px | 390px | 53px |

Di `input-penjualan.html`, seluruh kolom kanan — kartu **ITEM / BARANG**,
tempat Anda memasukkan produk ke nota — berada di luar layar. Tombol
**+ Tambah Item** tidak bisa disentuh. Halaman input penjualan praktis
tidak bisa dipakai di HP.

### Penyebabnya satu, bukan banyak

**Grid/flex min-content blowout.** Anak dari grid/flex secara bawaan punya
`min-width:auto` — artinya menolak menyusut lebih kecil dari isinya. Satu
tabel lebar di dalamnya membuat seluruh rantai `.card` → `.content` → `.main`
ikut melar. Di layar 390px, `.top-grid` menghitung kolomnya jadi
`240px 402px` = 642px.

Versi lama menutupinya dengan `overflow-x:hidden` pada `html, body`.
Itu bukan memperbaiki — itu **memotong**. Halaman jadi tidak bisa digeser
ke samping, jadi bagian yang meluber hilang begitu saja.

### Dan lapisan HP-nya memang tidak pernah bekerja

`mk-responsive.css` versi lama menyasar nama class yang **tidak ada di
halaman mana pun**: `.grid-3`, `.stat-grid`, `.form-row`, `.modal-box`,
`.table-wrap`, `.sticky-actions`, dan seterusnya.

Dari 17 kaitan class, **15 tidak cocok dengan satu elemen pun.** Yang
benar-benar jalan hanya bagian tabel→kartu (karena `mk-responsive.js`
menambahkan sendiri class `.mk-cards`).

Nama yang sebenarnya dipakai halaman ini: `.top-grid`, `.f2`, `.f3`, `.dg`,
`.ef-grid`, `.chart-grid`, `.sum-grid`, `.metric-cols`, `.modal`, `.card`,
`.field`, `.tab-bar`. Itu yang disasar sekarang.

**Perbaikannya:** `min-width:0` di rantai tata letak (memperbaiki sebabnya),
lalu aturan kolom yang menyasar nama class yang benar. `overflow-x:hidden`
global sengaja **dibuang** — kalau suatu saat ada yang lolos, halaman akan
bisa digeser ke samping. Jelek, tapi isinya masih terjangkau. Untuk aplikasi
kerja, tergeser jauh lebih aman daripada terpotong diam-diam.

---

## 3. Kenapa lambat — sebab sebenarnya

### a. Tiap halaman memicu beberapa eksekusi Apps Script sekaligus

Tiap panggilan ke `/exec` adalah **eksekusi Apps Script tersendiri**, dengan
cold start dan pembukaan spreadsheet masing-masing. Halaman memanggil
`Promise.all` dengan beberapa action — itu terlihat paralel di browser, tapi
di sisi Google tetap beberapa eksekusi terpisah.

| Halaman | Permintaan (v2) | Permintaan (v2.1) |
|---|---|---|
| tagihan | **5** | **1** |
| pelanggan | 4 | 1 |
| stats | 4 | 1 |
| ringkasan | 4 | 1 |
| data-penjualan | 3 | 1 |
| input-penjualan | 3 | 1 |

Angka di kolom kanan sudah diukur di browser sungguhan, bukan perkiraan.

Caranya: endpoint baru `?action=batch&a=aksi1,aksi2,...` menjalankan semuanya
dalam **satu** eksekusi dengan **satu** pembukaan spreadsheet.

Di sisi halaman, tidak ada satu pun file HTML yang diubah. `mk-net.js`
menampung permintaan yang terjadi pada tick JS yang sama (persis yang
dilakukan `Promise.all`) lalu mengirimnya sebagai satu permintaan.

### b. Cache server hanya menutupi 2 dari 9 endpoint

Di v2, `_CACHE_ALL = ['v2_pelanggan', 'v2_produk']`. Tujuh endpoint sisanya —
termasuk `getAllNotas` yang paling berat — **membaca spreadsheet setiap kali
diminta, oleh setiap orang, di setiap halaman.**

Sekarang semuanya di-cache. Ini cache **bersama**: satu orang yang membuka
halaman ikut menghangatkan cache untuk seluruh staf.

### c. Payload besar diam-diam tidak pernah tersimpan

`CacheService` punya batas 100KB per kunci. Kode lama menuliskan
`if (txt.length < 95000)` — lebih dari itu, **dilewati tanpa pesan apa pun**.
`getAllNotas` hampir pasti melewati batas ini. Jadi endpoint terberat justru
yang paling tidak pernah ter-cache.

Sekarang nilai besar dipecah otomatis jadi potongan (maksimal ~900KB).

### d. Menyimpan satu nota membuang SEMUA cache

`_bustCache(_CACHE_ALL)` dijalankan setelah setiap penulisan. Jadi saat
sedang sibuk input nota, cache tidak pernah sempat hangat.

Sekarang pembuangan cache mengikuti **sheet yang benar-benar ditulis**.
Menyimpan nota tidak lagi membuang cache produk.

> Satu hal yang mudah terlewat dan sudah diperhitungkan: `getPelanggan`
> ikut membaca *Data Penjualan* dan *Tagihan* lewat `_calcBelumTagih()`.
> Jadi menyimpan nota **tetap** harus membuang cache pelanggan. Peta
> ketergantungan di `Code.gs` sudah mencatat ini.
>
> Juga diperbaiki: `saveStock`, `addLangsiran`, dan `updateLangsiran` dulu
> **tidak membuang cache apa pun**. Dulu tidak masalah karena endpoint-nya
> memang belum di-cache. Sekarang di-cache, jadi wajib ikut.

### e. Pemanasan halaman berikutnya

`MK_NET.warm()` sudah ada sejak v2 tapi **tidak pernah dipanggil dari mana
pun**. Sekarang dipakai: 2,5 detik setelah halaman siap, saat browser
menganggur, data untuk halaman lain yang boleh dibuka peran user ini diambil
dalam satu permintaan batch.

Efeknya: klik menu → halaman berikutnya tampil seketika.

### f. Tiga kali `JSON.stringify` pada payload yang sama

Tiap penyegaran latar belakang menjalankan `JSON.stringify` tiga kali pada
payload yang sama (dua untuk membandingkan, satu untuk menyimpan). Pada
`getAllNotas` yang ratusan KB, itu terasa sebagai macet sesaat di HP.
Sekarang: satu kali, lalu dibandingkan lewat hash 32-bit.

---

## 4. Langkah pemasangan

**A. Backend — WAJIB, ini sumber percepatan terbesar**

Di sheet yang sedang dipakai: `Extensions → Apps Script`. Hapus semua isi,
tempel `Code.gs` yang baru. Lalu `Deploy → Manage deployments → Edit →
Version: New version → Deploy`.

Pakai **Manage → Edit**, bukan *New deployment*, supaya URL-nya tidak berubah
dan `mk-config.js` tidak perlu disentuh.

**B. Frontend**

Unggah ulang ke Cloudflare Pages. Yang berubah:

| File | Perubahan |
|---|---|
| `Code.gs` | endpoint `batch`, cache semua endpoint baca, cache berpotongan, pembuangan cache per-sheet |
| `mk-net.js` | penggabungan permintaan, pemanasan otomatis, sidik jari pengganti stringify ganda |
| `mk-responsive.css` | **ditulis ulang** — menyasar nama class yang benar-benar ada |
| `mk-config.js` | VERSION → 2.1.0 |
| 10 file `.html` | hanya tag `<meta viewport>` + `preconnect` font. Isi & logika tidak disentuh |

`auth.js`, `mk-responsive.js`, `nav.css`, `index.html`: **tidak berubah**.

**Urutan tidak kritis.** Frontend baru tetap jalan di atas `Code.gs` lama:
kalau backend belum kenal `action=batch`, `mk-net.js` otomatis mundur ke
permintaan satuan. Ini sudah diuji. Tapi selama backend belum di-deploy
ulang, Anda hanya dapat sebagian manfaatnya.

**C. Verifikasi (5 menit)**

1. Buka `tagihan.html` → DevTools → Network → filter `exec`.
   Harus ada **satu** permintaan `action=batch&a=...`, bukan lima.
2. Muat ulang halaman yang sama dalam 30 detik → harus **nol** permintaan.
3. Diamkan halaman ~3 detik → muncul satu permintaan `batch` lagi
   (itu pemanasan halaman berikutnya). Lalu klik menu lain → harus instan.
4. Buka `input-penjualan.html` di HP → kartu **ITEM / BARANG** harus
   terlihat penuh di bawah kartu Informasi Nota, dan tombol **+ Tambah Item**
   bisa disentuh. Dulu keduanya di luar layar.
5. Geser halaman ke samping di HP → tidak boleh bisa digeser.

---

## 5. Yang sudah diuji vs yang belum

Pengujian pakai Chromium sungguhan terhadap server tiruan yang meniru bentuk
payload asli dari `Code.gs`, dengan 600 nota (kira-kira setahun transaksi).

**Sudah diverifikasi:**

| Uji | Hasil |
|---|---|
| Meluber horizontal, 9 halaman × 3 ukuran layar | 0 dari 27 |
| tagihan.html: jumlah permintaan | 5 → **1** |
| Semua halaman lain | 3–4 → **1** |
| Desktop 1440px tidak berubah | **identik** (hanya frame animasi spinner yang beda) |
| Tablet 820px tetap 2 kolom di input-penjualan | ya — lebar tidak dibuang percuma |
| Modal di HP: muat, tidak keluar layar, tombol terjangkau | lulus |
| Tombol modal ≥38px (target sentuh) | lulus |
| Muat ulang dalam TTL | **0 permintaan** |
| Pemanasan otomatis mengisi cache halaman lain | lulus (9 kunci terisi) |
| Mundur ke permintaan satuan saat backend lama | lulus, tanpa error JS |
| Error JS di semua halaman | 0 |

**Belum diuji — ini yang harus Anda periksa sendiri:**

- **Semua alur tulis terhadap Google Sheet sungguhan.** Saya memakai server
  tiruan. Simpan nota, simpan tagihan, input stock, kirim/terima langsiran —
  semuanya perlu dicoba langsung. Ini bagian yang paling penting.
- **Peta pembuangan cache di kondisi nyata.** Saya sudah memetakan sheet mana
  yang ditulis tiap aksi, tapi logikanya baru terbukti benar saat dipakai:
  setelah simpan nota, cek angka *nota belum tagih* di halaman pelanggan
  ikut berubah.
- **Cetak nota & cetak harian.** CSS cetak tidak saya ubah, tapi tetap
  wajib dicek.
- **Logika kredit & grouping di `tagihan.html`** — tidak saya sentuh sama
  sekali, tapi halaman itu paling rumit.
- **Tampilan di tablet & HP asli.** Emulator bukan perangkat sungguhan.

---

## 6. Cara mundur kalau gagal

Frontend: unggah ulang file versi lama ke Cloudflare Pages.

Backend: `Deploy → Manage deployments → Edit → Version` → pilih versi
sebelumnya. Data tidak tersentuh sama sekali, jadi tidak ada yang perlu
dipulihkan.

Kalau hanya **satu halaman** yang bermasalah di HP, tambahkan
`class="mk-keep-table"` pada tabelnya — tabel itu kembali ke mode geser
samping.

---

## 7. Yang sengaja masih ditinggalkan

Supaya jelas apa yang **belum** dikerjakan:

1. **Tidak ada autentikasi di sisi server.** Ini yang paling serius dan
   belum tersentuh. `doGet` dan `doPost` tidak pernah memeriksa siapa yang
   memanggil, dan deployment-nya *Who has access: Anyone*. Siapa pun yang
   punya URL `/exec` bisa membaca seluruh data pelanggan dan penjualan, atau
   memanggil `deletePelanggan`, langsung dari console browser — tanpa login.
   Halaman login hanya mengatur tampilan, bukan akses data.

   Ikutannya: password tersimpan sebagai teks biasa di sheet Users, dikirim
   lewat query string `?password=`, dan sesi di localStorage tidak
   ditandatangani (siapa pun bisa mengetik `role:'admin'` di DevTools).

   Ini bukan pekerjaan kecil — perlu token, hash password, dan pemeriksaan
   peran di setiap handler. Tapi ini yang paling pantas dikerjakan berikutnya.

2. **Autosave draft nota** — nota setengah jadi masih hilang kalau halaman
   ter-refresh.

3. **Batas rentang tanggal `getAllNotas`** — masih mengembalikan seluruh
   riwayat. Cache berpotongan menunda masalahnya, tidak menghapusnya.
   Payload tetap tumbuh selamanya.

4. **Service Worker** — perangkat baru + internet mati + belum pernah
   membuka aplikasi = tetap tidak bisa apa-apa.
