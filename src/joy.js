
/* =====================================================================
   KÖÇA XARITASI + JOY TANLAŞ (masalan, yangi maktab uçun aniq oriyentir)
   • Fon: Esri / OpenStreetMap plitkalari (köça nomlari, uy raqamlari)
   • Nuqta tanlanganda: Nominatim (manzil) + Overpass (atrofdagi binolar,
     yöllar, kasalxona, maktab, bekat, sanoat) → masofalar va mezonlar
   ===================================================================== */
const ESRI = n => `https://server.arcgisonline.com/ArcGIS/rest/services/${n}/MapServer/tile/{z}/{y}/{x}`;
const BM = {
  // CARTO plitkalari endi API kalit talab qiladi — kalitsiz OpenStreetMap va Esri plitkalari
  xarita: { nomi: "Xarita", url: [["https://tile.openstreetmap.org/{z}/{x}/{y}.png"]], maxZ: 19, attr: "© OpenStreetMap hissadorlari" },
  sxema: { nomi: "Sxema", url: [[ESRI("World_Street_Map")]], maxZ: 19, attr: "© Esri, HERE, Garmin, © OpenStreetMap hissadorlari" },
  sputnik: { nomi: "Sputnik", url: [[ESRI("World_Imagery")]], maxZ: 19, attr: "© Esri, Maxar, Earthstar Geographics" },
  gibrid: { nomi: "Gibrid", url: [[ESRI("World_Imagery")], [ESRI("Reference/World_Transportation")], [ESRI("Reference/World_Boundaries_and_Places")]], maxZ: 19, attr: "© Esri, Maxar, HERE, Garmin, © OpenStreetMap hissadorlari" },
  tungi: { nomi: "Tungi", url: [[ESRI("Canvas/World_Dark_Gray_Base")], [ESRI("Canvas/World_Dark_Gray_Reference")]], maxZ: 16, attr: "© Esri, HERE, Garmin, © OpenStreetMap hissadorlari" }
};
// plitka rasmini özimiz yuklaymiz — deck.gl'ning global loader registriga bog'liq emas
const bmTile = async ({ url, signal }) => { if (!url) return null; const r = await fetch(url, { signal, mode: "cors" }); if (!r.ok) return null; const b = await r.blob(); return createImageBitmap(b); };
const BM_OLD = { osm: "xarita", yorug: "sxema" };
window.__BM = (() => { try { const v = localStorage.getItem("ol_bm"); return BM[v] ? v : BM[BM_OLD[v]] ? BM_OLD[v] : "xarita"; } catch (e) { return "xarita"; } })();
window.__B3D = (() => { try { return localStorage.getItem("ol_b3d") !== "0"; } catch (e) { return true; } })();
const BM_MINZ = 9;
window.__ZOOMED = false;
function zoomHook() {
  const z = VS.zoom, zoomed = z >= 10.3 ? true : z < 9.6 ? false : window.__ZOOMED, show = z >= BM_MINZ;
  let ch = false;
  if (zoomed !== window.__ZOOMED) { window.__ZOOMED = zoomed; if (!CITY) SLAB = zoomed ? 300 : 9000; ch = true; }
  // köça darajasida plita 2 m: fon xaritasi va 3D binolar yer sathida turadi (MVT binolari yerdan ösadi)
  const street = z >= 13.5 ? true : z < 13 ? false : window.__STREET; if (street !== window.__STREET) { window.__STREET = street; ch = true; }
  const want = window.__STREET ? 2 : CITY ? 300 : window.__ZOOMED ? 300 : 9000; if (SLAB !== want) { SLAB = want; ch = true; }
  if (show !== window.__BMSHOW) { window.__BMSHOW = show; ch = true; const a = $("#bmAttr"); if (a) a.style.display = show && LAY.bm && LAY.bm.visible ? "" : "none"; }
  const fine = z >= 12; if (fine !== window.__FINE) { window.__FINE = fine; ch = true; }
  const b3 = z >= 14.5; if (b3 !== window.__B3SHOW) { window.__B3SHOW = b3; ch = true; }
  if (ch) redraw();
}
// 1:10M Natural Earth yöl/daryo/köllari köça darajasida noaniq — 12-zumdan keyin yaşiriladi (fondagi aniq xarita körinadi)
[LAY.yol, LAY.dar, LAY.kol].forEach(l => { if (!l || !l.build) return; const b = l.build; l.build = ctx => VS.zoom >= 12 && window.__BMSHOW && LAY.bm && LAY.bm.visible ? [] : b(ctx); });
const zTop = ctx => ctx.is3D && !RELIEF() ? baseH() : 0;
LAY.bm = addLayer("Köça xaritasi (fon)", null, { kind: "raster", note: "Xarita · Sxema · Sputnik · Gibrid · Tungi — 9-zumdan körinadi", build: ctx => {
  if (!window.__BMSHOW) return [];
  const b = BM[window.__BM] || BM.xarita, zt = zTop(ctx) + 4;
  return b.url.map((u, n) => new TileLayer({ id: "bm-" + window.__BM + "-" + n, data: u, minZoom: 0, maxZoom: b.maxZ || 19, tileSize: 256, maxRequests: 8, refinementStrategy: "best-available", getTileData: bmTile, zRange: [zt, zt + 4], // plitkalar plita ustida — körinadigan plitkalarni shu balandlik böyiça tanlaş
    renderSubLayers: p => { const { west, south, east, north } = p.tile.bbox; return new BitmapLayer(p, { data: null, image: p.data, bounds: [[west, south, zt + n], [west, north, zt + n], [east, north, zt + n], [east, south, zt + n]], opacity: n ? 1 : .98, parameters: { depthCompare: "always", depthWriteEnabled: false } }); } }));
} });
// 3D binolar — OpenFreeMap vektor plitkalari (render_height), 14.5-zumdan
LAY.b3d = addLayer("3D binolar", null, { kind: "raster", note: "OpenStreetMap binolari · 14.5-zumdan", build: ctx => {
  if (!window.__B3SHOW || !window.__B3D || !VT.url) return [];
  const dark = window.__BM === "tungi" || window.__BM === "sputnik" || window.__BM === "gibrid";
  return [new MVTLayer({ id: "b3d", data: VT.url, minZoom: 14, maxZoom: 14, loadOptions: { mvt: { layers: ["building"] } }, zRange: [0, 250], binary: false, extruded: ctx.is3D, wireframe: false, material: MAT, pickable: false,
    getElevation: f => +f.properties.render_height || 6, getFillColor: dark ? [205, 212, 222, 225] : [228, 222, 210, 235], getLineColor: [120, 110, 100, 255], lineWidthMinPixels: 1, stroked: !ctx.is3D,
    filled: true, parameters: { depthCompare: "less-equal" } })];
} });
vtTemplate().then(() => redraw()).catch(() => { });
(() => { const i = LAYERS.indexOf(LAY.bm), v = LAYERS.indexOf(LAY.vil); if (i > -1 && v > -1) { LAYERS.splice(i, 1); LAYERS.splice(LAYERS.indexOf(LAY.vil) + 1, 0, LAY.bm); } const k = LAYERS.indexOf(LAY.b3d); if (k > -1) { LAYERS.splice(k, 1); LAYERS.splice(LAYERS.indexOf(LAY.bm) + 1, 0, LAY.b3d); } renderLayers(); })();
const BM_ATTR = () => BM[window.__BM].attr + " · 3D binolar: © OpenMapTiles, OpenFreeMap";
(() => { const a = document.createElement("div"); a.id = "bmAttr"; a.style.cssText = "position:absolute;right:10px;bottom:4px;z-index:5;font:11px/1.3 Inter,sans-serif;color:#cfd8e3;background:rgba(10,18,30,.6);padding:2px 6px;border-radius:4px;pointer-events:none;display:none"; a.textContent = BM_ATTR(); $("#map").appendChild(a); })();
function setBM(k) { if (!BM[k]) return; window.__BM = k; try { localStorage.setItem("ol_bm", k); } catch (er) { } const a = $("#bmAttr"); if (a) a.textContent = BM_ATTR(); LAY.bm.visible = true; document.querySelectorAll("[data-bm]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.bm === k))); const s = $("#jBm"); if (s) s.value = k; renderLayers(); redraw(); }

/* ---------- xarita turi tugmalari va manzil qidiruvi (Yandex uslubida) ---------- */
(() => {
  const st = document.createElement("style");
  st.textContent = `.msearch{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:11;width:440px}
  .msearch .box{display:flex;align-items:center;gap:6px;padding:5px 6px 5px 12px}.msearch input{flex:1;min-width:0;border:0;background:transparent;color:var(--ink);font:14px var(--body);outline:none;padding:6px 0}
  .msearch .res{margin-top:6px;max-height:50vh;overflow:auto;padding:4px;display:none}.msearch .res.on{display:block}
  .msearch .it{display:block;width:100%;text-align:left;border:0;background:transparent;color:var(--ink);padding:8px 10px;border-radius:8px;cursor:pointer;font:13px var(--body)}.msearch .it:hover,.msearch .it.sel{background:rgba(255,255,255,.08)}.msearch .it small{display:block;color:var(--ink-3);font-size:11.5px}
  .bmseg{display:flex;gap:2px;padding:3px;flex-wrap:wrap;justify-content:flex-end}.bmseg button{border:0;background:transparent;color:var(--ink-2);font:600 11.5px var(--body);padding:6px 9px;border-radius:999px;cursor:pointer}.bmseg button[aria-pressed="true"]{background:var(--ink);color:#0B1623}
  .title-chip{display:none}
  @media (max-width:900px){.msearch{left:14px!important;right:14px;width:auto!important;transform:none!important;top:calc(46vh + 24px)}}
  @media (max-width:760px){.msearch{left:8px!important;right:8px;width:auto!important;top:104px;bottom:auto}.bmseg{justify-content:space-between}.bmseg button{padding:6px 6px;font-size:11px}}`;
  document.head.appendChild(st);
  const w = document.createElement("div"); w.className = "msearch";
  w.innerHTML = `<div class="box glass"><span aria-hidden="true">🔍</span><input id="mq" type="search" placeholder="Manzil, köça, mahalla yoki obyekt…" autocomplete="off" aria-label="Manzil qidiriş"><button class="btn sm" id="mqGo" type="button">Topiş</button></div><div class="res glass" id="mres" role="listbox"></div>`;
  document.body.appendChild(w);
  // keng ekranda: panel va öng tomondagi tugmalar orasiga sigdiriş
  const place = () => { if (innerWidth <= 900) { w.style.left = w.style.width = w.style.transform = ""; return; }
    const hb = document.querySelector(".hudbar"), R = hb ? hb.getBoundingClientRect().left - 16 : innerWidth - 16, pn = $("#panel"), L = pn && !pn.classList.contains("hide") ? pn.getBoundingClientRect().right + 14 : 70;
    const W = Math.max(200, Math.min(440, R - L)), c = innerWidth / 2 - W / 2, x = c >= L && c + W <= R ? c : L;
    w.style.transform = "none"; w.style.left = x + "px"; w.style.width = W + "px"; };
  addEventListener("resize", place); setTimeout(place, 50); setTimeout(place, 1500);
  ["#hidePanel", "#showPanel"].forEach(id => { const b = $(id); if (b) b.addEventListener("click", () => setTimeout(place, 400)); });
  const seg = document.createElement("div"); seg.className = "bmseg glass"; seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "Xarita turi");
  seg.innerHTML = Object.entries(BM).map(([k, b]) => `<button type="button" data-bm="${k}" aria-pressed="${k === window.__BM}">${esc(b.nomi)}</button>`).join("") + `<button type="button" id="b3dBtn" aria-pressed="${window.__B3D}" title="3D binolar">3D binolar</button>`;
  const hud = document.querySelector(".hud"); if (hud) hud.insertBefore(seg, hud.children[1] || null);
  seg.addEventListener("click", e => { const b = e.target.closest("[data-bm]"); if (b) { setBM(b.dataset.bm); if (VS.zoom < BM_MINZ) toast("Köça xaritasi yaqinlaştirilganda körinadi"); }
    if (e.target.id === "b3dBtn") { window.__B3D = !window.__B3D; e.target.setAttribute("aria-pressed", String(window.__B3D)); try { localStorage.setItem("ol_b3d", window.__B3D ? "1" : "0"); } catch (er) { } redraw(); } });
  let items = [], sel = -1, tm = 0;
  const show = () => { const r = $("#mres"); r.classList.toggle("on", items.length > 0); r.innerHTML = items.map((x, i) => `<button type="button" class="it${i === sel ? " sel" : ""}" data-i="${i}" role="option">${esc(x.nomi)}<small>${esc(x.izoh || "")}</small></button>`).join(""); };
  const go = x => { items = []; show(); $("#mq").value = x.nomi;
    if (x.ext && x.ext.length === 4 && Math.abs(x.ext[2] - x.ext[0]) > .004) fitBBox([Math.min(x.ext[0], x.ext[2]), Math.min(x.ext[1], x.ext[3]), Math.max(x.ext[0], x.ext[2]), Math.max(x.ext[1], x.ext[3])], IS3D ? { pitch: 45 } : {}, 17);
    else setView({ longitude: x.lon, latitude: x.lat, zoom: 16.8, pitch: IS3D ? 50 : 0 }, 1200);
    LAYERS.filter(l => l._mark).forEach(l => removeLayer(l.id));
    const mk = addLayer("Qidiruv: " + x.nomi, null, { kind: "raster", derived: true, bbox: [x.lon - .003, x.lat - .002, x.lon + .003, x.lat + .002], build: ctx => { const z = zTop(ctx) + 10; return [new ScatterplotLayer({ id: "mq-pin", data: [x], getPosition: d => [d.lon, d.lat, z], getRadius: 9, radiusUnits: "pixels", getFillColor: [255, 79, 139], getLineColor: [255, 255, 255], lineWidthMinPixels: 3, stroked: true, parameters: { depthCompare: "always" } }), new TextLayer({ id: "mq-t", data: [x], getPosition: d => [d.lon, d.lat, z], getText: d => d.nomi, getSize: 13, getColor: [255, 255, 255], background: true, getBackgroundColor: [10, 20, 34, 220], backgroundPadding: [6, 3], getPixelOffset: [0, -22], characterSet: "auto", fontFamily: "Inter, Arial, sans-serif", parameters: { depthCompare: "always" } })]; } });
    mk._mark = true; redraw();
    const ll = $("#jLL"); if (ll) ll.value = `${x.lat.toFixed(6)}, ${x.lon.toFixed(6)}`;
  };
  const run = async () => { const q = $("#mq").value.trim(); if (q.length < 2) { items = []; return show(); }
    const ll = parseLL(q); if (ll && /^\s*-?\d/.test(q)) { items = [{ lon: ll.lon, lat: ll.lat, nomi: `${ll.lat.toFixed(6)}, ${ll.lon.toFixed(6)}`, izoh: "koordinata" }]; sel = 0; return show(); }
    const my = ++tm; const r = await geoSearch(q); if (my !== tm) return; items = r; sel = r.length ? 0 : -1; show(); if (!r.length) toast("Heç narsa topilmadi"); };
  let deb = 0; $("#mq").addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(run, 350); });
  $("#mq").addEventListener("keydown", e => { if (e.key === "ArrowDown") { sel = Math.min(items.length - 1, sel + 1); show(); e.preventDefault(); } else if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); show(); e.preventDefault(); } else if (e.key === "Enter") { if (items[sel]) go(items[sel]); else run(); } else if (e.key === "Escape") { items = []; show(); } });
  $("#mqGo").addEventListener("click", () => items[sel] ? go(items[sel]) : run());
  $("#mres").addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (b) go(items[+b.dataset.i]); });
  document.addEventListener("click", e => { if (!w.contains(e.target)) { items = []; show(); } });
})();

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
const objName = p => p ? p.name || p["name:uz"] || p["name:ru"] || "" : "";
const addrOf = p => p ? [p["addr:street"], p["addr:housenumber"]].filter(Boolean).join(", ") : "";
function parseLL(s) { const m = String(s).match(/(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)/); if (!m) return null; let a = +m[1].replace(",", "."), b = +m[2].replace(",", "."); if (a > 50 && b < 50) [a, b] = [b, a]; return { lat: a, lon: b }; }
async function nomin(lat, lon) { return geoReverse(lat, lon); }
async function joyFetch(lat, lon) {
  // asosiy manba — vektor plitkalar (2 km atrof, ~9–16 plitka, keşlanadi); zaxira — Overpass
  try {
    const bb = turf.bbox(turf.circle([lon, lat], 2.1, { units: "kilometers", steps: 16 }));
    const fc = await vtFeatures(bb, ["poi", "transportation", "transportation_name", "landuse", "building", "housenumber"], { onProgress: (d, n) => $("#busyT").textContent = `Atrofdagi obyektlar: xarita plitkalari ${d}/${n}…` });
    // binolar va uy raqamlari faqat 600 m atrofda (natijada eng yaqinlari körsatiladi; aks holda şahar markazida o'n minglab bino hisoblanadi)
    const nb = turf.bbox(turf.circle([lon, lat], .6, { units: "kilometers", steps: 16 })), inNb = f => { const b = turf.bbox(f); return b[2] >= nb[0] && b[0] <= nb[2] && b[3] >= nb[1] && b[1] <= nb[3]; };
    fc.features = fc.features.filter(f => !(f.properties.building || f.properties["addr:housenumber"]) || inNb(f));
    const hn = fc.features.filter(f => f.properties["addr:housenumber"] && !f.properties.building), blds = fc.features.filter(f => f.properties.building && isPoly(f));
    // uy raqamini bino poligoniga biriktiriş (manzil uçun)
    if (hn.length && blds.length) { const idx = blds.map(b => ({ b, bb: turf.bbox(b) })); hn.forEach(h => { const [x, y] = h.geometry.coordinates; const hit = idx.find(o => x >= o.bb[0] && x <= o.bb[2] && y >= o.bb[1] && y <= o.bb[3] && safe(() => turf.booleanPointInPolygon(h, o.b))); if (hit && !hit.b.properties["addr:housenumber"]) hit.b.properties["addr:housenumber"] = h.properties["addr:housenumber"]; }); }
    // köça nomi: eng yaqin nomli köçani binoga "addr:street" sifatida biriktiriş
    const named = fc.features.filter(f => f.properties.highway && f.properties.name && /Line/.test(f.geometry.type) && inNb(f));
    if (named.length) blds.forEach(b => { if (!b.properties["addr:housenumber"]) return; const c = safe(() => turf.centroid(b)); if (!c) return; let best = null, bd = .08; for (const r of named) { const d = safe(() => turf.pointToLineDistance(c, r, { units: "kilometers" })); if (d != null && d < bd) { bd = d; best = r; } } if (best) b.properties["addr:street"] = best.properties.name; });
    // piyoda yölaklari, zinapoyalar va dala yöllari "kiriş yöli" hisoblanmaydi (Overpass sörovidagi kabi)
    const feats = fc.features.filter(f => (!f.properties["addr:housenumber"] || f.properties.building) && !/^(footway|path|pedestrian|steps|cycleway|bridleway|platform|track|corridor)$/.test(f.properties.highway || ""));
    return { fc: { type: "FeatureCollection", features: feats }, areas: [], src: "OpenFreeMap vektor plitkalari" };
  } catch (e) { console.warn("Vektor plitkalar:", e); }
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
        new SolidPolygonLayer({ id: "jbld", data: BL, getPolygon: d => d.poly.map(r => r.map(c => [c[0], c[1], z])), extruded: ctx.is3D, getElevation: d => d.h, getFillColor: d => d.top ? [242, 184, 75, 235] : [150, 168, 190, 200], getLineColor: [20, 30, 45], material: MAT, pickable: true, tipFn: d => ({ title: objName(d.p) || "Bino", props: { manzil: addrOf(d.p) || "—", qavatlar: d.p["building:levels"] || "—", turi: d.p.building === "yes" ? "bino" : d.p.building } }), parameters: { depthCompare: "less-equal" } }),
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
          ${inside ? `<li style="color:var(--warn)">⚠ Nuqta bino içida: <b>${esc(objName(inside.p) || addrOf(inside.p) || (inside.p.building === "yes" ? "nomsiz bino" : inside.p.building))}</b></li>` : ""}
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
      <p class="small muted">Masofalar — töğri çiziq böyiça. Manba: OpenStreetMap (OpenFreeMap vektor plitkalari; zaxira — Overpass; manzil — Nominatim/Photon). OSM'da çizilmagan bino yoki muassasa hisobga kirmaydi. Mezon qiymatlarini amaldagi şaharsozlik normalariga qarab özgartiring.</p>`;
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
$("#jBm").addEventListener("change", e => setBM(e.target.value));
zoomHook();
