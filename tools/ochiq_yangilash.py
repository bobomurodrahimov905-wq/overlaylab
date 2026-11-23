#!/usr/bin/env python3
"""OverlayLab — ochiq ma'lumotlarni yangilash (GitHub Actions har kuni ishga tushiradi).

1) Milliy statistika qo'mitasi SIAT API dan doimiy aholi sonini oladi
   (indikator 246: respublika, 14 hudud va barcha tuman/shaharlar, SOATO kodlari bilan)
   -> ochiq/aholi.json
2) geoBoundaries API dan O'zbekiston chegaralari (ADM1, ADM2) versiyasini tekshiradi
   -> ochiq/holat.json  (chegara yangilansa, workflow GitHub Issue ochadi)

Faqat Python standart kutubxonasi ishlatiladi. Xato bo'lsa eski fayl saqlanib qoladi.
"""
import json, os, sys, urllib.request, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "ochiq")
UA = {"User-Agent": "OverlayLab-ochiq-malumot/1.0 (+https://github.com/bobomurodrahimov905-wq/overlaylab)"}
SIAT_ID = 246
SIAT_API = f"https://api.siat.stat.uz/sdmx/{SIAT_ID}/table/download/?download_format=json"
SIAT_FILE = f"https://api.siat.stat.uz/media/uploads/sdmx/sdmx_data_{SIAT_ID}.json"
GB = "https://www.geoboundaries.org/api/current/gbOpen/UZB/{}/"


def get_json(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8-sig"))


def num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(" ", "").replace(" ", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def save(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def siat():
    meta = {}
    try:
        meta = get_json(SIAT_API)
        url = meta.get("file") or SIAT_FILE
    except Exception as e:
        print("SIAT API meta olinmadi, to'g'ridan-to'g'ri fayl:", e)
        url = SIAT_FILE
    raw = get_json(url)
    block = raw[0] if isinstance(raw, list) else raw
    data = block["data"]
    years = sorted({k for r in data for k in r if k.isdigit() and len(k) == 4})
    rows = []
    for r in data:
        tarix = {y: num(r.get(y)) for y in years if num(r.get(y)) is not None}
        if not tarix:
            continue
        last = max(tarix)
        rows.append({"kod": str(r.get("Code", "")).strip(), "nomi": r.get("Klassifikator"),
                     "nomi_ru": r.get("Klassifikator_ru"), "nomi_en": r.get("Klassifikator_en"),
                     "qiymat": tarix[last], "qiymat_yili": last, "tarix": tarix})
    nat = next((r for r in rows if r["kod"] == "1700"), None)
    if not nat or len(rows) < 150:
        raise RuntimeError(f"SIAT javobi kutilganday emas: {len(rows)} qator")
    yil = nat["qiymat_yili"]
    kodlar = set(load(os.path.join(OUT, "kodlar.json"), []))
    return {
        "manba": {"nomi": "O‘zbekiston Milliy statistika qo‘mitasi — SIAT (siat.stat.uz)",
                  "indikator": f"{SIAT_ID} · Doimiy aholi soni (jami)", "sahifa": f"https://siat.stat.uz/data/{SIAT_ID}/",
                  "api": SIAT_API, "litsenziya": "CC BY 4.0 (stat.uz)"},
        "birlik": "ming kişi", "yil": yil, "sana": f"{yil}-01-01",
        "manbada_yangilangan": meta.get("updated_at"),
        "olingan": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "qatorlar": rows,
        "xaritada_yoq": [{"kod": r["kod"], "nomi": r["nomi"], "qiymat": r["qiymat"]} for r in rows
                         if len(r["kod"]) == 7 and kodlar and r["kod"] not in kodlar],
    }


def boundaries(prev):
    out = {}
    for lvl in ("ADM1", "ADM2"):
        m = get_json(GB.format(lvl))
        if isinstance(m, list):
            m = m[0]
        out[lvl] = {k: m.get(k) for k in ("boundaryID", "boundaryYearRepresented", "buildDate",
                                         "sourceDataUpdateDate", "admUnitCount", "boundarySource",
                                         "boundaryLicense", "gjDownloadURL", "simplifiedGeometryGeoJSON")}
    old = (prev or {}).get("chegaralar") or {}
    changed = bool(old) and any((old.get(l) or {}).get("buildDate") != out[l]["buildDate"] or
                                (old.get(l) or {}).get("boundaryID") != out[l]["boundaryID"] for l in out)
    return out, changed


def main():
    os.makedirs(OUT, exist_ok=True)
    holat_path = os.path.join(OUT, "holat.json")
    holat = load(holat_path, {})
    ok = True
    try:
        a = siat()
        old = load(os.path.join(OUT, "aholi.json"), {})
        same = {r["kod"]: r["qiymat"] for r in old.get("qatorlar", [])} == {r["kod"]: r["qiymat"] for r in a["qatorlar"]}
        if same and not old.get("boshlangich_nusxa") and old.get("manbada_yangilangan") == a["manbada_yangilangan"]:
            print("SIAT: o'zgarish yo'q")
        else:
            save(os.path.join(OUT, "aholi.json"), a)
            print(f"SIAT: yangilandi — {len(a['qatorlar'])} qator, {a['yil']}-yil")
        holat["aholi"] = {"yil": a["yil"], "olingan": a["olingan"], "manbada_yangilangan": a["manbada_yangilangan"],
                          "xaritada_yoq": a["xaritada_yoq"]}
    except Exception as e:
        ok = False
        print("XATO (SIAT):", e, file=sys.stderr)
        holat.setdefault("xatolar", {})["aholi"] = str(e)
    try:
        ch, changed = boundaries(holat)
        holat["chegaralar"] = ch
        holat["chegara_ozgardi"] = changed
        if changed:
            print("DIQQAT: geoBoundaries'da yangi chegara versiyasi chiqdi")
    except Exception as e:
        print("XATO (geoBoundaries):", e, file=sys.stderr)
        holat.setdefault("xatolar", {})["chegaralar"] = str(e)
    holat["tekshirildi"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    save(holat_path, holat)
    gh = os.environ.get("GITHUB_OUTPUT")
    if gh:
        with open(gh, "a") as f:
            f.write(f"chegara_ozgardi={'true' if holat.get('chegara_ozgardi') else 'false'}\n")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
