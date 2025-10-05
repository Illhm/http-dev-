# Ekspor ReqRes Menggunakan Python

Skrip `tools/export_requests.py` merupakan port Python dari logika ekspor
Dashboard ReqRes DevTools Lite. Skrip ini dapat membantu ketika Anda ingin
mengonversi log network yang telah dikumpulkan extension menjadi arsip ZIP
berstruktur tanpa perlu membuka dashboard.

## Format Input

- Berkas JSON dengan daftar objek request/respon.
- Struktur bidang mengikuti hasil `bg.js` (lihat contoh di `samples/reqres-sample.json`).
- Input juga boleh berupa objek `{ "entries": [...] }` atau `{ "records": [...] }`.

## Cara Pakai

```bash
python tools/export_requests.py samples/reqres-sample.json \
  --output reqres_readable.zip \
  --kinds xhr js img \
  --text example
```

Parameter penting:

- `--kinds`: pilih kategori resource (default semua).
- `--hide-data-url`: sembunyikan request dengan skema `data:`.
- `--text`: filter substring (case-insensitive) pada URL/body.
- `--limit`: batasi jumlah entri yang diekspor.

Output akan menghasilkan struktur folder berikut di dalam ZIP:

```
README.md
index.csv
index.md
00001__GET__example.comapi_data/
  00-meta.txt
  01-request-headers.txt
  02-request-body.json
  03-response-headers.txt
  04-response-body.json
  05-response-info.json
00002__GET__example.comassets_logo_png/
  ...
```

Berkas `05-response-info.json` berisi metadata tambahan seperti `timing`,
`encodedDataLength`, serta informasi encoding body.
