# OverlayLab saytini yig'ish: python build.py  (src/ ichida ishga tushiring)
# Natija: ../index.html, ../js/app.js, ../data.js
import json, os, re
H = os.path.dirname(os.path.abspath(__file__)); R = os.path.dirname(H)
SITE_URL = "https://bobomurodrahimov905-wq.github.io/overlaylab/"   # <-- sayt manzili (README ga qarang)
head = open(os.path.join(H, "head.html"), encoding="utf-8").read()
SEO = f'''<title>OverlayLab — Özbekiston fazoviy ma’lumotlarini ustma-ust tahlil qiliş GIS platformasi</title>
<meta name="description" content="OverlayLab — Özbekistonning 14 hududi va 199 ta tumani, daryolari, yöllari va relyefi bo'yicha 3D GIS platforma: ustma-ust tahlil (Intersect, Union, Buffer), MCDA moslik xaritasi va jonli aholi statistikasi.">
<meta name="keywords" content="GIS, geoaxborot tizimlari, ustma-ust tahlil, overlay analysis, Özbekiston xaritasi, tumanlar, aholi, MCDA, AHP, 3D xarita, OverlayLab, TATU">
<meta name="author" content="Rahimov Bobomurod">
<meta name="robots" content="index, follow">
<link rel="canonical" href="{SITE_URL}">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website"><meta property="og:url" content="{SITE_URL}">
<meta property="og:title" content="OverlayLab — Özbekiston 3D GIS ustma-ust tahlil platformasi">
<meta property="og:description" content="14 hudud, 199 tuman, jonli aholi statistikasi, Intersect/Union/Buffer va MCDA — brauzerda, örnatişsiz.">
<meta property="og:image" content="{SITE_URL}og.jpg"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{json.dumps({"@context":"https://schema.org","@type":"WebApplication","name":"OverlayLab","url":SITE_URL,"applicationCategory":"EducationalApplication","operatingSystem":"Web brauzer","inLanguage":"uz","description":"Özbekiston fazoviy ma'lumotlarini ustma-ust tahlil qiliş uçun 3D GIS platforma.","author":{"@type":"Person","name":"Rahimov Bobomurod"},"offers":{"@type":"Offer","price":"0","priceCurrency":"UZS"}},ensure_ascii=False)}</script>'''
head = head.replace("<title>OverlayLab GIS</title>", SEO, 1)
head = head.replace('<small>GIS · 3D ustma-ust tahlil</small>', '<small>GIS · 3D ustma-ust tahlil · <a href="about.html" style="color:inherit">loyiha haqida</a></small>', 1)
libs = ["https://cdn.jsdelivr.net/npm/deck.gl@9.0.41/dist.min.js", "https://cdn.jsdelivr.net/npm/@turf/turf@7.1.0/turf.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.11.0/proj4.js", "https://cdn.jsdelivr.net/npm/shpjs@4.0.4/dist/shp.min.js",
        "https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js",
        "config.js", "js/baza.js", "data.js", "js/app.js"]
noscript = '<noscript><div style="padding:24px;max-width:720px">OverlayLab — Özbekiston fazoviy ma’lumotlarini ustma-ust tahlil qiliş GIS platformasi. Platforma işlaşi uçun brauzerda JavaScript yoqilgan bölişi kerak. <a href="about.html">Loyiha haqida</a></div></noscript>\n'
out = head + noscript + "".join(f'<script src="{u}"></script>\n' for u in libs) + "</body>\n</html>\n"
open(os.path.join(R, "index.html"), "w", encoding="utf-8").write(out)
names = ["davlatlar", "viloyatlar", "daryolar", "kollar", "shaharlar", "yollar"]
data = {k: json.load(open(os.path.join(H, "data", k + ".json"), encoding="utf-8")) for k in names}
data["chegaralar"] = json.load(open(os.path.join(H, "data", "shahar_chegara.json"), encoding="utf-8"))
data["tumanlar"] = json.load(open(os.path.join(H, "data", "tumanlar.json"), encoding="utf-8"))
# SOATO kodlari (SIAT bilan bog'lash uchun): data/kod_xarita.json  "viloyat|tuman" -> kod
KOD = json.load(open(os.path.join(H, "data", "kod_xarita.json"), encoding="utf-8"))
for f in data["tumanlar"]["fc"]["features"]:
    p = f["properties"]; p["soato"] = KOD[p["viloyat"] + "|" + p["nomi"]]
os.makedirs(os.path.join(R, "ochiq"), exist_ok=True)
json.dump(sorted(KOD.values()), open(os.path.join(R, "ochiq", "kodlar.json"), "w"))
if not os.path.exists(os.path.join(R, "ochiq", "aholi.json")):   # birinchi marta: boshlang'ich nusxa
    import shutil; shutil.copy(os.path.join(H, "data", "aholi_boshlangich.json"), os.path.join(R, "ochiq", "aholi.json"))
data["dem"] = json.load(open(os.path.join(H, "data", "dem.json"), encoding="utf-8"))
open(os.path.join(R, "data.js"), "w", encoding="utf-8").write("window.__DATA__=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
os.makedirs(os.path.join(R, "js"), exist_ok=True)
open(os.path.join(R, "js", "app.js"), "w", encoding="utf-8").write(open(os.path.join(H, "app.js"), encoding="utf-8").read() + open(os.path.join(H, "soha.js"), encoding="utf-8").read() + open(os.path.join(H, "joy.js"), encoding="utf-8").read())
print("tayyor:", os.path.join(R, "index.html"))
