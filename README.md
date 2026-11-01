# Omni Sahabat Bunda — Testing

Prototipe web lokal untuk menguji login dan wewenang, produk, pesanan, stok/batch/expired, opname, cetak resi contoh, serta pengajuan retur dan penerimaan barang oleh admin.

## Menjalankan web

Memerlukan Node.js 20 atau lebih baru. Tidak perlu npm install untuk server.

```sh
cd omni-prototype
node server.mjs
```

Buka http://127.0.0.1:8765. Petunjuk dan akun demo tersedia di [README prototipe](omni-prototype/README.md).

Akun dan password demo sengaja disediakan untuk data sintetis. Aplikasi hanya mendengarkan localhost; belum siap untuk deployment publik atau data produksi. File data/auth dan sesi lokal tidak disertakan. Server membuat data contoh baru saat pertama dijalankan.

## Isi repositori

- `omni-prototype/`: aplikasi web aktif, server Node, aset, aturan domain dan pengujian.
- `omni_backend/`: eksperimen fondasi domain Python/SQLite yang berdiri sendiri, belum terhubung ke UI.

## Pengujian

```sh
node --test omni-prototype/tests.mjs
python3 -m unittest discover -s omni_backend/tests -v
```

Pengujian browser opsional: `node omni-prototype/verify-web.cjs`, memerlukan Playwright dan Google Chrome. Atur `PLAYWRIGHT_MODULE` ke lokasi modul Playwright bila diperlukan. Pengujian memakai server dan data sementara terpisah.

## Batas prototipe

Data contoh; belum terhubung ke Shopee, TikTok, Desty, Accurate atau Cici Kelola. Tracking retur dicatat manual. Label cetak adalah contoh, bukan resi resmi. Refund belum memindahkan uang atau membuat jurnal. Penerimaan retur masuk karantina dan belum memiliki alur pelepasan QC. Modul iklan, chat, dan pembukuan lengkap masih tahap berikutnya.
