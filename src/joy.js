
/* =====================================================================
   KÖÇA XARITASI + JOY TANLAŞ (masalan, yangi maktab uçun aniq oriyentir)
   • Fon: Esri / OpenStreetMap plitkalari (köça nomlari, uy raqamlari)
   • Nuqta tanlanganda: Nominatim (manzil) + Overpass (atrofdagi binolar,
     yöllar, kasalxona, maktab, bekat, sanoat) → masofalar va mezonlar
   ===================================================================== */
const BM = {
  // CARTO plitkalari endi API kalit talab qiladi ("API KEY REQUIRED") — kalitsiz Esri plitkalari ishlatiladi
  tungi: { nomi: "Tungi (Esri Dark Gray)", url: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"], maxZ: 16, attr: "© Esri, HERE, Garmin, © OpenStreetMap hissadorlari" },
  yorug: { nomi: "Yorug‘ (Esri Street Map)", url: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"], maxZ: 19, attr: "© Esri, HERE, Garmin, © OpenStreetMap hissadorlari" },
  osm: { nomi: "Batafsil (OpenStreetMap)", url: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], maxZ: 19, attr: "© OpenStreetMap hissadorlari" }
};
window.__BM = (() => { try { return localStorage.getItem("ol_bm") || "tungi"; } catch (e) { return "tungi"; } })();
const BM_MINZ = 9;
window.__ZOOMED = false;
function zoomHook() {
  const z = VS.zoom, zoomed = z >= 10.3 ? true : z < 9.6 ? false : window.__ZOOMED, show = z >= BM_MINZ;
  let ch = false;
  if (zoomed !== window.__ZOOMED) { window.__ZOOMED = zoomed; if (!CITY) SLAB = zoomed ? 300 : 9000; ch = true; }
  if (show !== window.__BMSHOW) { window.__BMSHOW = show; ch = true; const a = $("#bmAttr"); if (a) a.style.display = show && LAY.bm && LAY.bm.visible ? "" : "none"; }
  const fine = z >= 12; if (fine !== window.__FINE) { window.__FINE = fine; ch = true; }
  if (ch) redraw();
}
// 1:10M Natural Earth yöl/daryo/köllari köça darajasida noaniq — 12-zumdan keyin yaşiriladi (fondagi aniq xarita körinadi)
[LAY.yol, LAY.dar, LAY.kol].forEach(l => { if (!l || !l.build) return; const b = l.build; l.build = ctx => VS.zoom >= 12 && window.__BMSHOW && LAY.bm && LAY.bm.visible ? [] : b(ctx); });
const zTop = ctx => ctx.is3D && !RELIEF() ? baseH() : 0;
LAY.bm = addLayer("Köça xaritasi (fon)", null, { kind: "raster", note: "Esri / OpenStreetMap plitkalari · 9-zumdan körinadi", build: ctx => {
  if (!window.__BMSHOW) return [];
  const b = BM[window.__BM] || BM.tungi, zt = zTop(ctx) + 4;
  return [new TileLayer({ id: "bm-" + window.__BM, data: b.url, minZoom: 0, maxZoom: b.maxZ || 19, tileSize: 256, maxRequests: 8, refinementStrategy: "best-available",
    renderSubLayers: p => { const { west, south, east, north } = p.tile.bbox; return new BitmapLayer(p, { data: null, image: p.data, bounds: [[west, south, zt], [west, north, zt], [east, north, zt], [east, south, zt]], opacity: .97, parameters: { depthCompare: "always", depthWriteEnabled: false } }); } })];
} });
(() => { const i = LAYERS.indexOf(LAY.bm), v = LAYERS.indexOf(LAY.vil); if (i > -1 && v > -1) { LAYERS.splice(i, 1); LAYERS.splice(v + 1, 0, LAY.bm); renderLayers(); } })();
(() => { const a = document.createElement("div"); a.id = "bmAttr"; a.style.cssText = "position:absolute;right:10px;bottom:4px;z-index:5;font:11px/1.3 Inter,sans-serif;color:#cfd8e3;background:rgba(10,18,30,.6);padding:2px 6px;border-radius:4px;pointer-events:none;display:none"; a.textContent = BM[window.__BM].attr; $("#map").appendChild(a); })();

/* ---------- joy tahlili ---------- */
const JOY = { pick: false, last: null };
const JOY_TUR = {
  maktab: { nomi: "Maktab", mez: [
    ["bino", "Nuqta mavjud bino içida emas", null, "yöq"],
    ["magistral", "Katta (magistral) yöldan uzoqlik", 50, ">="],
    ["yol", "Kirish yöligaça", 300, "<="],
    ["tib", "Eng yaqin tibbiyot muassasasigaça", 1000, "<="],
    ["mak", "Mavjud maktabdan uzoqlik", 500, ">="],
    ["san", "Sanoat obyektidan uzoqlik", 500, ">="],
    ["temir", "Temir yöldan uzoqlik", 100, ">="],
    ["bekat", "Jamoat transporti bekatigaça", 500, "<="]] },
  bogcha: { nomi: "Bolalar bog‘çasi", mez: [
    ["bino", "Nuqta mavjud bino içida emas", null, "yöq"],
    ["magistral", "Katta (magistral) yöldan uzoqlik", 50, ">="],
    ["yol", "Kirish yöligaça", 200, "<="],
    ["tib", "Eng yaqin tibbiyot muassasasigaça", 1000, "<="],
    ["bog", "Mavjud bog‘çadan uzoqlik", 300, ">="],
    ["san", "Sanoat obyektidan uzoqlik", 500, ">="],
    ["temir", "Temir yöldan uzoqlik", 100, ">="]] },
  klinika: { nomi: "Poliklinika", mez: [
    ["bino", "Nuqta mavjud bino içida emas", null, "yöq"],
    ["yol", "Kirish yöligaça", 100, "<="],
    ["tib", "Mavjud tibbiyot muassasasidan uzoqlik", 1000, ">="],
    ["san", "Sanoat obyektidan uzoqlik", 300, ">="],
    ["bekat", "Jamoat transporti bekatigaça", 300, "<="]] }
};
const MAJOR = /^(motorway|trunk|primary|secondary)(_link)?$/;
const HWN = { motorway: "avtomagistral", trunk: "magistral", primary: "asosiy köça", secondary: "ikkinçi darajali köça", tertiary: "uçinçi darajali köça", unclassified: "mahalliy yöl", residential: "turar-joy köçasi", living_street: "turar-joy köçasi", service: "xizmat yöli", motorway_link: "magistral çiqişi", trunk_link: "magistral çiqişi", primary_link: "asosiy köça çiqişi", secondary_link: "köça çiqişi" };
const yon = b => RUMB[Math.round(((b % 360) + 360) % 360 / 45) % 8];
const mFmt = km => km < 1 ? Math.round(km * 1000) + " m" : fmt(km, 2) + " km";
const objName = p => p.name || p["name:uz"] || p["name:ru"] || "";
const addrOf = p => [p["addr:street"], p["addr:housenumber"]].filter(Boolean).join(", ");
function parseLL(s) { const m = String(s).match(/(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)/); if (!m) return null; let a = +m[1].replace(",", "."), b = +m[2].replace(",", "."); if (a > 50 && b < 50) [a, b] = [b, a]; return { lat: a, lon: b }; }
async function nomin(lat, lon) {
  try { const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=uz,ru`, { signal: AbortSignal.timeout(15000) }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
async function joyFetch(lat, lon) {
  const L = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  const q = `[out:json][timeout:40];(nwr(around:2000,${L})["amenity"~"^(hospital|clinic|doctors|pharmacy|school|kindergarten|college|university)$"];nwr(around:2000,${L})["healthcare"~"^(hospital|clinic|centre|doctor)$"];node(around:1000,${L})["highway"="bus_stop"];node(around:1000,${L})["public_transport"="platform"];nwr(around:2000,${L})["landuse"="industrial"];nwr(around:2000,${L})["man_made"="works"];)->.p;.p out center tags;(way(around:700,${L})["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$"];way(around:1200,${L})["railway"="rail"];way(around:300,${L})["building"];)->.g;.g out geom;is_in(${L})->.a;area.a["name"]["admin_level"]->.ad;.ad out tags;`;
  const j = await overpassRaw(q, "Atrofdagi obyektlar olinmoqda");
  return { fc: osm2fc(j), areas: (j.elements || []).filter(e => e.type === "area").map(e => e.tags || {}) };
}
async function joyAnalyze(lat, lon) {
  if (!(lat > 34 && lat < 48 && lon > 54 && lon < 77)) return toast("Nuqta Özbekiston hududidan taşqarida");
  const tur = $("#jTur").value, T = JOY_TUR[tur], pt = turf.point([lon, lat]);
  { const zz = Math.max(VS.zoom, 16.3); setView({ longitude: lon, latitude: lat - (MOB() ? .0016 : .0011) * Math.pow(2, 16.3 - zz), zoom: zz, pitch: IS3D ? 50 : 0 }, 900); }
  await busy(true, "Joy tahlil qilinmoqda…");
  try {
    const [o, nm] = await Promise.all([joyFetch(lat, lon), nomin(lat, lon)]);
    const fs = o.fc.features, P = f => f.properties || {};
    const ptOf = f => f.geometry.type === "Point" ? f : turf.pointOnFeature(f);
    const near = (arr, fn) => arr.map(f => { const d = fn(f); return { f, d, p: P(f), b: turf.bearing(pt, d.at || ptOf(f)) }; }).sort((a, b) => a.d.km - b.d.km);
    const toPt = f => ({ km: turf.distance(pt, ptOf(f)), at: ptOf(f) });
    const toLine = f => { const n = turf.nearestPointOnLine(f, pt); return { km: n.properties.dist, at: n }; };
    const toPoly = f => { if (safe(() => turf.booleanPointInPolygon(pt, f))) return { km: 0, at: pt, inside: true }; const ls = turf.polygonToLine(f), ln = ls.type === "FeatureCollection" ? ls.features[0] : ls, n = turf.nearestPointOnLine(ln, pt); return { km: n.properties.dist, at: n }; };
    const isAm = (f, re) => re.test(P(f).amenity || "") || (re.source.includes("hospital") && /^(hospital|clinic|centre|doctor)$/.test(P(f).healthcare || ""));
    const roads = near(fs.filter(f => P(f).highway && /Line/.test(f.geometry.type)), toLine);
    const major = roads.filter(r => MAJOR.test(r.p.highway));
    const rail = near(fs.filter(f => P(f).railway === "rail"), toLine);
    const blds = near(fs.filter(f => P(f).building && isPoly(f)), toPoly);
    const tib = near(fs.filter(f => isAm(f, /^(hospital|clinic|doctors)$/)), toPt);
    const mak = near(fs.filter(f => /^(school)$/.test(P(f).amenity || "")), toPt);
    const bog = near(fs.filter(f => P(f).amenity === "kindergarten"), toPt);
    const bekat = near(fs.filter(f => P(f).highway === "bus_stop" || P(f).public_transport === "platform"), toPt);
    const san = near(fs.filter(f => P(f).landuse === "industrial" || P(f).man_made === "works"), toPt);
    const inside = blds.find(b => b.d.inside);
    const val = { bino: inside ? 0 : 1, magistral: major[0] ? major[0].d.km * 1000 : null, yol: roads[0] ? roads[0].d.km * 1000 : null, tib: tib[0] ? tib[0].d.km * 1000 : null, mak: mak[0] ? mak[0].d.km * 1000 : null, bog: bog[0] ? bog[0].d.km * 1000 : null, san: san[0] ? san[0].d.km * 1000 : null, temir: rail[0] ? rail[0].d.km * 1000 : null, bekat: bekat[0] ? bekat[0].d.km * 1000 : null };
    const thr = Object.fromEntries([...document.querySelectorAll("#jMez input[data-k]")].map(i => [i.dataset.k, +i.value]));
    const rows = T.mez.map(([k, txt, def, op]) => { const v = val[k], t = thr[k] ?? def; let ok, show;
      if (op === "yöq") { ok = v === 1; show = ok ? "bino yöq" : "bino içida: " + (objName(inside.p) || addrOf(inside.p) || "bino"); }
      else if (v == null) { ok = op === ">="; show = op === ">=" ? "atrofda (≤ 2 km) topilmadi" : "atrofda topilmadi"; }
      else { ok = op === ">=" ? v >= t : v <= t; show = Math.round(v) + " m"; }
      return { k, txt, op, t, ok, show }; });
    const okN = rows.filter(r => r.ok).length;
    const a = nm && nm.address || {}, area = o.areas.slice().sort((x, y) => (+y.admin_level || 0) - (+x.admin_level || 0));
    const mahalla = a.neighbourhood || a.quarter || (area.find(x => +x.admin_level >= 8) || {}).name || "";
    const tuman = a.city_district || a.suburb || a.county || (area.find(x => +x.admin_level === 6) || {}).name || "";
    const manzil = [a.road, a.house_number].filter(Boolean).join(", ") || (nm && nm.name) || "";
    const shahar = a.city || a.town || a.village || a.state || "";
    // xaritaga
    const LN = [], LB = [], PTS = [];
    const link = (r, col, label) => { if (!r) return; const to = r.d.at.geometry.coordinates; LN.push({ path: [[lon, lat], to], col }); LB.push({ p: [(lon + to[0]) / 2, (lat + to[1]) / 2], t: label + " · " + mFmt(r.d.km), col }); PTS.push({ p: to, col }); };
    link(roads[0], [233, 162, 78], "yöl");
    if (major[0] && major[0] !== roads[0]) link(major[0], [255, 120, 60], "magistral");
    link(tib[0], [255, 79, 139], objName(tib[0] && tib[0].p) || "tibbiyot");
    link(mak[0], [91, 184, 255], objName(mak[0] && mak[0].p) || "maktab");
    if (tur !== "klinika") link(bog[0], [126, 211, 33], objName(bog[0] && bog[0].p) || "bog‘ça");
    link(bekat[0], [247, 209, 84], objName(bekat[0] && bekat[0].p) || "bekat");
    if (blds[0] && !inside) link(blds[0], [220, 226, 235], addrOf(blds[0].p) || objName(blds[0].p) || "bino");
    const rings = [250, 500, 1000].map(m => ({ path: turf.circle([lon, lat], m / 1000, { steps: 72, units: "kilometers" }).geometry.coordinates[0], m }));
    const POI = [...tib.slice(0, 8).map(r => ({ r, c: [255, 79, 139] })), ...mak.slice(0, 8).map(r => ({ r, c: [91, 184, 255] })), ...bog.slice(0, 6).map(r => ({ r, c: [126, 211, 33] })), ...bekat.slice(0, 6).map(r => ({ r, c: [247, 209, 84] }))].map(({ r, c }) => ({ p: ptOf(r.f).geometry.coordinates, c, t: objName(r.p) }));
    const BL = blds.slice(0, 600).map(r => ({ poly: r.f.geometry.type === "Polygon" ? r.f.geometry.coordinates : r.f.geometry.coordinates[0], h: (+r.p["building:levels"] || 0) * 3.2 || +String(r.p.height || "").replace(/[^\d.]/g, "") || 6, top: r === blds[0] || r.d.inside, p: r.p }));
    LAYERS.filter(l => l._joy).forEach(l => removeLayer(l.id));
    const lay = addLayer(`Joy tahlili · ${lat.toFixed(5)}, ${lon.toFixed(5)}`, null, { kind: "raster", derived: true, note: `${T.nomi} uçun · ${okN}/${rows.length} mezon`, bbox: turf.bbox(turf.circle([lon, lat], 1, { units: "kilometers" })), build: ctx => { const z = zTop(ctx), Z = c => [c[0], c[1], z + 8];
      return [
        new SolidPolygonLayer({ id: "jbld", data: BL, getPolygon: d => d.poly.map(r => r.map(c => [c[0], c[1], z])), extruded: ctx.is3D, getElevation: d => d.h, getFillColor: d => d.top ? [242, 184, 75, 235] : [150, 168, 190, 200], getLineColor: [20, 30, 45], material: MAT, pickable: true, tipFn: d => ({ title: objName(d.p) || "Bino", props: { manzil: addrOf(d.p) || "—", qavatlar: d.p["building:levels"] || "—", turi: d.p.building } }), parameters: { depthCompare: "less-equal" } }),
        new PathLayer({ id: "jring", data: rings, getPath: d => d.path.map(Z), getColor: [255, 255, 255, 110], getWidth: 1.5, widthUnits: "pixels", getDashArray: [6, 4], parameters: { depthCompare: "always" } }),
        new TextLayer({ id: "jringt", data: rings, getPosition: d => Z(d.path[0]), getText: d => d.m + " m", getSize: 12, getColor: [230, 236, 242], characterSet: "auto", getPixelOffset: [0, -8], parameters: { depthCompare: "always" } }),
        new PathLayer({ id: "jln", data: LN, getPath: d => d.path.map(Z), getColor: d => [...d.col, 240], getWidth: 3, widthUnits: "pixels", parameters: { depthCompare: "always" } }),
        new ScatterplotLayer({ id: "jpoi", data: POI, getPosition: d => Z(d.p), getRadius: 5, radiusUnits: "pixels", getFillColor: d => [...d.c, 230], getLineColor: [10, 20, 35], lineWidthMinPixels: 1, stroked: true, pickable: true, tipFn: d => ({ title: d.t || "obyekt", props: {} }), parameters: { depthCompare: "always" } }),
        new ScatterplotLayer({ id: "jend", data: PTS, getPosition: d => Z(d.p), getRadius: 4, radiusUnits: "pixels", getFillColor: d => [...d.col, 255], parameters: { depthCompare: "always" } }),
        new ScatterplotLayer({ id: "jpin", data: [{ p: [lon, lat] }], getPosition: d => Z(d.p), getRadius: 9, radiusUnits: "pixels", getFillColor: [255, 79, 139], getLineColor: [255, 255, 255], lineWidthMinPixels: 3, stroked: true, parameters: { depthCompare: "always" } }),
        new TextLayer({ id: "jlb", data: LB, getPosition: d => Z(d.p), getText: d => d.t, getSize: 13, getColor: [255, 255, 255], background: true, getBackgroundColor: [10, 20, 34, 215], backgroundPadding: [5, 3], getBorderColor: d => [...d.col, 255], getBorderWidth: 1, characterSet: "auto", fontFamily: "Inter, Arial, sans-serif", parameters: { depthCompare: "always" } })
      ]; } });
    lay._joy = true;
    const li = (arr, n, f) => arr.length ? arr.slice(0, n).map(f).join("") : `<li class="muted">2 km ichida topilmadi</li>`;
    const pl = r => `<li><b>${esc(objName(r.p) || "nomsiz")}</b> — ${mFmt(r.d.km)}, ${yon(r.b)}da${addrOf(r.p) ? ` · <span class="muted">${esc(addrOf(r.p))}</span>` : ""}</li>`;
    const cp = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    const html = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:18px;align-items:start">
      <div style="min-width:0">
        <div class="kpis"><div class="kpi"><b class="num">${okN}/${rows.length}</b><span>${esc(T.nomi)} uçun mezon bajarildi</span></div></div>
        <p style="margin:6px 0 2px"><b>${esc(manzil || "Manzil topilmadi")}</b></p>
        <p class="small muted" style="margin:0">${esc([mahalla && mahalla + (/(mahalla|МФЙ|махалл)/i.test(mahalla) ? "" : " mahallasi"), tuman, shahar].filter(Boolean).join(" · "))}</p>
        <p class="small" style="margin:6px 0"><span class="num">${cp}</span> <button class="btn" type="button" id="jCopy" style="padding:2px 8px">nusxa</button>
          <a href="https://yandex.uz/maps/?pt=${lon},${lat}&z=17&l=map" target="_blank" rel="noopener">Yandex</a> · <a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank" rel="noopener">Google</a> · <a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}" target="_blank" rel="noopener">OSM</a></p>
        <table class="t" style="width:100%">${rows.map(r => `<tr><td>${r.ok ? "✅" : "❌"} ${esc(r.txt)}${r.t != null && r.op !== "yöq" ? ` <span class="muted">(${r.op === ">=" ? "≥" : "≤"} ${r.t} m)</span>` : ""}</td><td class="r num">${esc(r.show)}</td></tr>`).join("")}</table>
      </div>
      <div class="small" style="min-width:0">
        <h3>Oriyentirlar</h3>
        <ul style="margin:0 0 8px;padding-left:18px">
          ${inside ? `<li style="color:var(--warn)">⚠ Nuqta bino içida: <b>${esc(objName(inside.p) || addrOf(inside.p) || inside.p.building)}</b></li>` : ""}
          ${blds.filter(b => !b.d.inside).slice(0, 3).map(b => `<li>Bino: <b>${esc(addrOf(b.p) || objName(b.p) || "manzilsiz bino")}</b> — ${mFmt(b.d.km)}, ${yon(b.b)}da${b.p["building:levels"] ? `, ${b.p["building:levels"]} qavat` : ""}</li>`).join("")}
          ${roads[0] ? `<li>Eng yaqin yöl: <b>${esc(objName(roads[0].p) || "nomsiz")}</b> (${esc(HWN[roads[0].p.highway] || roads[0].p.highway)}) — ${mFmt(roads[0].d.km)}</li>` : ""}
          ${major[0] ? `<li>Katta yöl: <b>${esc(objName(major[0].p) || HWN[major[0].p.highway])}</b> — ${mFmt(major[0].d.km)}, ${yon(major[0].b)}da</li>` : ""}
          ${rail[0] ? `<li>Temir yöl — ${mFmt(rail[0].d.km)}</li>` : ""}
        </ul>
        <h3>Tibbiyot</h3><ul style="margin:0 0 8px;padding-left:18px">${li(tib, 3, pl)}</ul>
        <h3>Maktablar</h3><ul style="margin:0 0 8px;padding-left:18px">${li(mak, 3, pl)}</ul>
        <h3>Bog‘çalar</h3><ul style="margin:0 0 8px;padding-left:18px">${li(bog, 2, pl)}</ul>
        <h3>Bekat va sanoat</h3><ul style="margin:0;padding-left:18px">${li(bekat, 2, pl)}${san[0] ? `<li>Sanoat: <b>${esc(objName(san[0].p) || "sanoat hududi")}</b> — ${mFmt(san[0].d.km)}</li>` : ""}</ul>
      </div></div>
      <p class="small muted">Masofalar — töğri çiziq böyiça. Manba: OpenStreetMap (Overpass, Nominatim). OSM'da çizilmagan bino yoki muassasa hisobga kirmaydi. Mezon qiymatlarini amaldagi şaharsozlik normalariga qarab özgartiring.</p>`;
    const csv = toCsv(["mezon", "qiymat", "chegara", "natija"], rows.map(r => [r.txt, r.show, r.t ?? "", r.ok ? "bajarildi" : "bajarilmadi"]));
    setDrawer(`${T.nomi} uçun joy · ${manzil || cp}`, `${okN}/${rows.length} mezon · ${mahalla || tuman || shahar}`, html, ["joy_" + slug(manzil || cp) + ".csv", csv], () => { const b = $("#jCopy"); if (b) b.onclick = () => { try { navigator.clipboard.writeText(cp); toast("Koordinata nusxalandi"); } catch (e) { } }; });
    DRAWER.bind && DRAWER.bind();
    JOY.last = { lat, lon }; $("#jLL").value = cp;
  } catch (er) { console.error(er); toast(er.message || String(er)); sLog(`<span style="color:var(--bad)">✕ ${esc(er.message || er)}</span>`); }
  await busy(false);
}
function joyMez() { const T = JOY_TUR[$("#jTur").value]; $("#jMez").innerHTML = T.mez.filter(m => m[2] != null).map(([k, t, d, op]) => `<label class="f">${esc(t)} ${op === ">=" ? "≥" : "≤"}, m<input type="number" data-k="${k}" value="${d}" min="0" step="10"></label>`).join(""); }
function joyPickMode(on) { JOY.pick = on; $("#jPick").classList.toggle("primary", on); $("#jPick").textContent = on ? "Xaritani bosing… (bekor qiliş)" : "📍 Xaritadan tanlaş"; $("#map").style.cursor = on ? "crosshair" : ""; window.__pick = on ? info => { const [lon, lat] = info.coordinate; joyAnalyze(lat, lon); } : null; }
$("#jTur").addEventListener("change", joyMez); joyMez();
$("#jPick").addEventListener("click", () => joyPickMode(!JOY.pick));
$("#jGo").addEventListener("click", () => { const c = parseLL($("#jLL").value); if (!c) return toast("Koordinatani “41.340815, 69.286411” körinişida kiriting"); joyAnalyze(c.lat, c.lon); });
$("#jLL").addEventListener("keydown", e => { if (e.key === "Enter") $("#jGo").click(); });
$("#jGeo").addEventListener("click", () => { if (!navigator.geolocation) return toast("Brauzer joylaşuvni bermaydi"); navigator.geolocation.getCurrentPosition(p => joyAnalyze(p.coords.latitude, p.coords.longitude), e => toast("Joylaşuv olinmadi: " + e.message), { enableHighAccuracy: true, timeout: 15000 }); });
$("#jBm").innerHTML = Object.entries(BM).map(([k, b]) => `<option value="${k}"${k === window.__BM ? " selected" : ""}>${esc(b.nomi)}</option>`).join("");
$("#jBm").addEventListener("change", e => { window.__BM = e.target.value; try { localStorage.setItem("ol_bm", window.__BM); } catch (er) { } $("#bmAttr").textContent = BM[window.__BM].attr; LAY.bm.visible = true; renderLayers(); redraw(); });
zoomHook();
