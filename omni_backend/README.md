# Fondasi domain Omni Sahabat Bunda

Implementasi lokal tahap awal, menggunakan Python 3.9+ dan SQLite bawaan. Tidak perlu memasang paket. Belum memiliki web UI, autentikasi pengguna, konektor marketplace/Accurate/Cici, ataupun proses penulisan ke layanan luar.

Saat ini mendukung:

- SKU internal dengan huruf besar/kecil dan tanda baca yang dipertahankan.
- Identitas listing berdasarkan toko, produk, dan varian.
- Snapshot stok fisik dengan versi berurutan yang disediakan adapter lokal.
- Reservasi atomik untuk order yang belum dikirim, dengan buffer stok dan pemeriksaan kekurangan stok.
- Deduplikasi ID kejadian dan ID order per toko; konflik payload ditolak.
- Pembatalan seluruh order tanpa melepas stok dua kali.
- Perhitungan kontribusi memakai Decimal; HPP kosong menghasilkan status belum lengkap.

## Jalankan pengujian

Dari folder utama Sahabat Bunda:

```sh
python3 -m unittest discover -s omni_backend/tests -v
```

Pengujian memakai database sementara dan data sintetis. Termasuk persaingan dua koneksi atas unit stok terakhir, pengulangan order/kejadian, pembatalan terlambat, rollback order multibaris, versi stok lama, dan HPP kosong.

Hasil pada 31 Oktober 2026: 10 pengujian lolos dengan Python 3.9.6. Pengujian ini memverifikasi aturan lokal; belum memverifikasi perilaku API layanan luar.

## Penggunaan minimal

```python
from omni_backend.core import OmniCore

core = OmniCore()  # Database sementara di memori; bukan data produksi.
try:
    core.add_store("test-shop", "test", "Toko uji")
    core.add_product("TEST-SKU", "Barang uji")
    core.set_stock_snapshot("test-warehouse", "TEST-SKU", 5, version=1, safety_stock=1)
    core.reserve_order("test-shop", "test-order", "event-1", "test-warehouse", {"TEST-SKU": 2})
    print(core.inventory("test-warehouse", "TEST-SKU"))
finally:
    core.close()
```

## Batas implementasi

Fondasi ini belum boleh menerima umpan produksi. Belum ada pengiriman/retur/paket terpisah, perubahan isi order, jurnal stok permanen, histori HPP per transaksi, pembatalan sebelum order diterima, maupun penggabungan snapshot Accurate dengan order yang telah mengurangi stok. Adapter kelak harus mengantre kejadian di luar urutan dan merekonsiliasi reservasi saat barang dikirim agar stok tidak dikurangi dua kali.

`version` adalah kontrak internal berurutan, bukan nama field API Accurate yang diasumsikan tersedia. Kuantitas saat ini harus berupa unit bulat. Dukungan konversi satuan/paket dan kuantitas pecahan perlu ditambahkan sebelum barang terkait dimigrasikan. Biaya pada `contribution()` harus sudah dipisahkan agar komponen biaya tidak terhitung ganda; hasilnya merupakan estimasi kontribusi, bukan laba pembukuan resmi.

Fondasi domain ini merupakan eksperimen terpisah; belum terhubung ke server web dalam `omni-prototype`.
