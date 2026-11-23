# Ochiq ma'lumotlarga ulanish

| Ma'lumot | Manba | Qanday yangilanadi |
|---|---|---|
| Doimiy aholi (respublika, 14 hudud, 199 tuman/şahar) | Milliy statistika qo'mitasi SIAT API, indikator 246 | GitHub Actions har kuni `tools/ochiq_yangilash.py` ni ishga tushiradi → `ochiq/aholi.json` |
| Aholi zichligi | aholi ÷ maydon | sahifa ochilganda hisoblanadi |
| Maydon, perimetr | chegara geometriyasidan (LAEA) | chegara yangilansa qayta hisoblanadi |
| Chegaralar | geoBoundaries (UZB ADM1/ADM2) | har kuni versiyasi tekshiriladi; yangi versiya chiqsa repoda Issue ochiladi |

Bog'lash nom bo'yicha emas, **SOATO kodi** bo'yicha (`src/data/kod_xarita.json`).
SIAT'da bor, lekin xaritada chegarasi hali yo'q birliklar (2020-yildan keyin tuzilgan) saytda alohida ko'rsatiladi.

## Yoqish
1. Barcha fayllarni repoga yuklang (`.github/` papkasi ham — u yashirin papka).
2. GitHub → **Settings → Actions → General → Workflow permissions → Read and write permissions** → Save.
3. **Actions → "Ochiq ma'lumotlarni yangilash" → Run workflow** — birinchi marta qo'lda ishga tushiring.
4. Yashil belgi chiqsa, `ochiq/aholi.json` yangilangan bo'ladi. Qizil bo'lsa, log'ni oching: odatda SIAT serveri javob bermagan bo'ladi — sayt eski fayl bilan ishlashda davom etadi.

## "Sohalar" bo'limi — 6 amaliy yo'nalish
Ma'lumot tahlil bosilganda brauzerning o'zida olinadi (kalit kerak emas):

| Yo'nalish | Ustma-ust qo'yiladigan qatlamlar | Manba |
|---|---|---|
| Qishloq xo'jaligi | nishablik + balandlik + kanalga masofa (+ tuproq, sho'rlanish GeoTIFF) → har dala uchun eng mos ekin | OpenStreetMap, ETOPO1, foydalanuvchi rasterlari |
| Shaharsozlik | maktab, poliklinika, yo'l buferlari ∩ turar joylar | OpenStreetMap |
| Favqulodda vaziyatlar | zilzilalar (M≥4, 1960-yildan) + sel yo'li (tog' + soy) + maktablar → xavf xaritasi | USGS Earthquake Catalog, OpenStreetMap, ETOPO1 |
| Suv xo'jaligi | daryo/kanal buferi → muhofaza zonasi ∩ qurilishlar; dalalarning kanalga yaqinligi | OpenStreetMap |
| Ekologiya | sanoat obyektlari + 1 yillik shamol yo'nalishi → ifloslanish zonasi ∩ turar joy, maktablar | OpenStreetMap, Open-Meteo (ERA5) |
| Kadastr | yer konturlari (yoki yuklangan kadastr Shapefile) ∩ tuman chegaralari → yer balansi | OpenStreetMap yoki foydalanuvchi qatlami |
