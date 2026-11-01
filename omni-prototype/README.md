# Omni Sahabat Bunda — Prototipe Web 01

Versi browser dengan login userid/password, data contoh, dan server lokal. Dibuat mengikuti keputusan 1 November 2026. Belum dipublikasikan online dan belum menjadi sistem produksi.

## Buka dan jalankan

Alamat: **http://127.0.0.1:8765** saat server berjalan.

Server dapat dimulai dengan `python3 server.py`, atau `node server.mjs` dari folder ini. Launcher `Mulai Omni.command` tersedia sebagai alternatif untuk menyalakan server dan membuka browser, bukan aplikasi desktop yang perlu diinstal. Node.js 20+ diperlukan; launcher memakai Node yang sudah tersedia di runtime Codex bila PATH tidak memuat Node. Ctrl+C menghentikan server.

## Akun prototype

| Peran | Userid | Password demo |
| --- | --- | --- |
| Owner | `owner.demo` | `OwnerDemo!2026` |
| Gudang | `gudang.demo` | `GudangDemo!2026` |
| Auditor | `auditor.demo` | `AuditorDemo!2026` |

Akun tetap untuk data sintetis; jangan dipakai pada deployment atau data nyata. Password diverifikasi server dengan hash scrypt. Sesi memakai cookie HttpOnly/SameSite=Strict, token CSRF dan expiry delapan jam. Restart server mengakhiri sesi, tetapi mempertahankan data. Belum ada MFA, undangan, reset password, atau konfigurasi production HTTPS.

## Coba alur

1. Login Owner, buka Produk & harga, tambah SKU, dan periksa HPP.
2. Buat pesanan dibayar satu SKU. Available berkurang sementara fisik tetap.
3. Buka pesanan → picking → packing → serah terima dengan bukti contoh. Fisik berkurang sekali ketika handoff.
4. Batalkan pesanan setelah picking; barang tetap terikat sampai konfirmasi restock.
5. Terima MPASI/perawatan: batch dan expired wajib, minimum umur 30/60 hari. Barang tidak memenuhi aturan dapat masuk karantina.
6. Keluar dan login Gudang. Buat opname dengan hasil hitung dan alasan; saldo pembanding tersembunyi saat input.
7. Keluar dan login Owner, review lalu approve/reject. Pembuat tidak boleh menyetujui sendiri; delta mempertahankan pergerakan setelah cutoff dan tidak boleh menabrak reservation.
8. Owner mengatur hak tindakan/field HPP dan cakupan gudang akun demo. Login Gudang/Auditor untuk memeriksa perbedaannya.

## Penyimpanan dan keamanan prototipe

- `data/state.json` menyimpan data contoh secara atomik melalui rename. `data/auth.json` menyimpan hash dan salt akun. Keduanya diabaikan Git dan tidak disajikan sebagai file web.
- Server Node satu proses hanya mendengarkan 127.0.0.1. Host dan Origin dibatasi ke localhost, mutasi memerlukan sesi/CSRF, percobaan login dibatasi, dan payload dibatasi 64 KiB.
- Server menentukan pelaku dari sesi, bukan dari JSON pengguna. Hak dan scope dievaluasi saat command; data gudang lain dan HPP yang tidak diizinkan disaring dari respons.
- Nomor revisi mencegah command dari snapshot yang sudah usang. Pesan konflik meminta refresh; transaksi multi-instance/database belum disediakan.
- Ekspor JSON dan reset contoh hanya untuk Owner. Reset mempertahankan akun/password dan mengganti data operasional sintetis. Data prototype browser lama tidak diimpor otomatis.
- Semua gambar dan source antarmuka lokal. Google Fonts opsional; tanpa internet memakai font sistem.

## Batas tahap pertama

Satu SKU per order, unit bulat, pengiriman penuh, kategori/aturan contoh. Partial shipment, transfer gudang, bundle/UOM, CSV/impor asli, MFA dan pengelolaan akun produksi belum dibuat. Iklan, chat, pembelian lengkap serta pembukuan sendiri ditampilkan di roadmap. Laba kotor belum dikurangi fee/iklan dan bukan laba bersih; HPP kosong menghasilkan belum lengkap. Aplikasi tidak mengakses marketplace atau Accurate/Cikol.

TRD produksi tetap mengusulkan database transaksional dan infrastruktur yang sesuai. Server JSON ini membantu pengujian alur web, bukan pengganti arsitektur produksi atau audit log immutable.

## Pengujian

- `node --test tests.mjs`: invariant domain, FEFO, expiry, cancellation/restock, handoff, count/approval, scope dan field grants.
- `node verify-web.cjs`: API dan browser, menggunakan data sementara serta port 18765 terpisah. Memerlukan Playwright dan Chrome; `PLAYWRIGHT_MODULE` dapat menunjuk modul Playwright yang tersedia. Default memakai runtime Codex lokal.
- `verification.json` mencatat hasil pemeriksaan web terbaru. Screenshot `preview-login.png`, `preview-dashboard.png`, dan `preview-mobile.png` memakai data uji, bukan kondisi akun produksi.

Website lama, Obsidian, dan eksperimen `omni_backend` tidak diganti.

## Pengajuan pelanggan dan barang balik

Tab Pengajuan batal / retur / refund mencatat keputusan; tab Dikirim balik menampilkan ekspedisi, resi balik, perjalanan, penerimaan sebagian, dan penerimaan lengkap. Detail pesanan menyediakan Catat pengajuan pelanggan → Setujui → Catat barang dikirim balik → Barang diterima admin. Pengajuan pembatalan memblokir pemrosesan; barang yang sudah dipicking tetap perlu restock fisik.

Admin penerimaan harus memiliki izin Terima stok dan batch serta akses gudang pesanan. Setiap penerimaan memiliki referensi unik, jumlah, batch asal, kondisi, waktu, dan pelaku. Barang masuk lot karantina terpisah, tidak langsung tersedia dijual; penerimaan berlebih atau berulang ditolak. Tracking kurir masih manual. Satu pengajuan per pesanan untuk prototipe ini; kasus lanjutan dan pelepasan karantina setelah QC belum tersedia. Refund hanya pencatatan keputusan, belum pembayaran atau jurnal; angka penjualan/laba masih bruto sebelum retur/refund.

Pesanan baru memilih Shopee A/B/C atau TikTok Shop A/B/C, ekspedisi dan resi contoh. Pesanan lama tidak diubah diam-diam: lengkapi melalui detail. Cetak resi membuat label contoh (bukan resi marketplace), mencatat permintaan dan meminta konfirmasi berhasil/gagal; percobaan ulang wajib konfirmasi dan alasan. Hasil printer fisik tidak dapat diverifikasi otomatis. Data lama tetap dipertahankan tanpa reset.
